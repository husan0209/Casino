import { createHmac, timingSafeEqual } from 'crypto'

import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Decimal } from 'decimal.js'

import { errorMessage } from '@/common/utils/error-message'

import { DISPLAY_RUB_RATES, type DisplayCurrency } from '@casino/shared-config'

import { PaymentProviderNotConfiguredError } from './rukassa.client'
import { PaymentProviderError } from '../../domain/errors'
import {
  assertReleaseCryptoCurrency,
  CRYPTO_PAY_CURRENCY_TICKERS,
} from '../../domain/payment-currency.policy'

import type { INowPaymentsClient } from '../../domain/payments.ports'

/**
 * Тикеры NOWPayments по нашим внутренним кодам валют (TZ-02).
 *
 * Крипто-пары берутся из релизного набора домена (`payment-currency.policy`) —
 * единственное место, где перечислены поддерживаемые платёжные валюты; веток
 * под TON/TRX/LTC (исключены из релиза) здесь больше нет.
 *
 * `RUB` — не платёжная валюта, а служебный `currency_to` в GET /estimate
 * (курсы для KYC-лимитов), поэтому живёт отдельно от релизного набора.
 * Fallback `toLowerCase()` в `mapCurrency` обслуживает только estimate-пары с
 * display-фиатом (UAH/BYN/KZT/UZS): там курс запрашивается, платёж не создаётся.
 * Отклонение НЕподдерживаемой платёжной валюты — задача не этого словаря, а
 * `assertReleaseCryptoCurrency` (см. `createPayment`).
 */
const PROVIDER_CURRENCY_TICKERS: Record<string, string> = {
  ...CRYPTO_PAY_CURRENCY_TICKERS,
  RUB: 'rub',
}

const TIMEOUT_MS = 30_000

/**
 * Ответы NOWPayments — внешние PSP-данные, НЕ trusted (AI_DEVELOPMENT_RULES §6.1):
 * реальная форма может отличаться по версиям API, поэтому поля типизированы
 * unknown и читаются через String()/Number() с fallback'ом; деньги переводятся
 * в string сразу на границе парсинга (String(...), без parseFloat — §1).
 */

/** POST /payment — создание платежа. */
interface NOWPaymentsCreatePaymentResponse {
  payment_id?: unknown
  pay_address?: unknown
  pay_amount?: unknown
  pay_currency?: unknown
  expiration_estimate_date?: unknown
}

/** GET /payment/{id} — статус платежа. */
interface NOWPaymentsPaymentStatusResponse {
  payment_status?: unknown
  actually_paid?: unknown
  outcome_amount?: unknown
}

/** GET /estimate — оценка курса. */
interface NOWPaymentsEstimateResponse {
  estimated_amount?: unknown
}

/**
 * Сужение недоверенного JSON до объекта ответа PSP: null/массив/примитив
 * трактуем как пустой объект — поля считаются отсутствующими, сработают fallback'и.
 */
function asPspResponse<T extends object>(json: unknown): T {
  return json !== null && typeof json === 'object' && !Array.isArray(json) ? (json as T) : ({} as T)
}

/** Ответ /payment: имена поля могут отличаться по версиям API. */
function parseCreateResponse(json: unknown): { paymentId: string; payAddress: string } {
  const d = asPspResponse<NOWPaymentsCreatePaymentResponse>(json)
  return {
    paymentId: String(d.payment_id ?? ''),
    payAddress: String(d.pay_address ?? ''),
  }
}

/**
 * NOWPayments HTTP client — TZ part 3 §6 (UC-PAY-03/04).
 *
 * Публичный API: {NOWPAYMENTS_API_BASE|https://api.nowpayments.io/v1}
 *   POST /payment   {price_amount, price_currency, pay_currency, order_id, ipn_callback_url}
 *   GET  /payment/{id}
 *   GET  /estimate?amount&currency_from&currency_to
 * Auth: заголовок x-api-key = NOWPAYMENTS_API_KEY (обязателен в production).
 *
 * IPN подпись: HMAC-SHA512(NOWPAYMENTS_IPN_SECRET, JSON отсортированных по ключу полей),
 * заголовок x-nowpayments-sig.
 */
@Injectable()
export class NOWPaymentsClient implements INowPaymentsClient {
  private readonly logger = new Logger(NOWPaymentsClient.name)
  constructor(@Inject(ConfigService) private config: ConfigService) {}

  private isProd(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production'
  }

  /** DEV/STAGE без ключа: детерминированный платёж, чтобы флоу был проходим end-to-end. */
  private devStubPayment(params: {
    priceAmount: string
    priceCurrency: string
    payCurrency: string
    orderId: string
  }): {
    paymentId: string
    payAddress: string
    payAmount: string
    payCurrency: string
    expirationEstimateDate: string
  } {
    this.logger.log(
      `NOWPayments DEV-STUB create ${params.priceAmount} ${params.priceCurrency}->${params.payCurrency} order=${params.orderId}`,
    )
    return {
      paymentId: `np_${params.orderId}`,
      payAddress: 'TX' + params.orderId.replace(/-/g, '').slice(0, 30),
      payAmount: params.priceAmount,
      payCurrency: this.mapCurrency(params.payCurrency),
      expirationEstimateDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }
  }

  private assertApiKey(): string {
    const key = this.config.get<string>('NOWPAYMENTS_API_KEY')
    if (!key) {
      throw new PaymentProviderNotConfiguredError('NOWPayments', 'NOWPAYMENTS_API_KEY')
    }
    return key
  }

  private base(): string {
    return this.config.get<string>('NOWPAYMENTS_API_BASE') || 'https://api.nowpayments.io/v1'
  }

  mapCurrency(ours: string): string {
    return PROVIDER_CURRENCY_TICKERS[ours] || ours.toLowerCase()
  }

  async createPayment(params: {
    priceAmount: string
    priceCurrency: string
    payCurrency: string
    orderId: string
    ipnCallbackUrl: string
  }): Promise<{
    paymentId: string
    payAddress: string
    payAmount: string
    payCurrency: string
    expirationEstimateDate: string
  }> {
    // TZ-02: платёжная валюта проверяется до ЛЮБОГО обращения к провайдеру —
    // и до реального POST /payment, и до dev-stub (он тоже эмулирует «платёж
    // создан»). Иначе заявка в TON/TRX/LTC уходила бы в NOWPayments с
    // pay_currency вне релизного набора.
    const payCurrency = assertReleaseCryptoCurrency(params.payCurrency)
    if (!this.isProd() && !this.config.get<string>('NOWPAYMENTS_API_KEY')) {
      return this.devStubPayment({ ...params, payCurrency })
    }
    const apiKey = this.assertApiKey()
    try {
      const res = await fetch(`${this.base()}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          // Контракт NOWPayments POST /v1/payment: price_amount — ЧИСЛО (не строка).
          // MoneyAmount-правило не нарушается: в наше доменное поле деньги приходят
          // строкой (params.priceAmount: string), провайдеру уходит число по его
          // спецификации (docs/PAYMENT_OVERVIEW.md, решение В11).
          price_amount: Number(params.priceAmount),
          // Тот же маппер, что у pay_currency: NOWPayments принимает только
          // буквенно-цифровые тикеры, а наше имя USDT_TRC20 содержит подчёркивание.
          // toLowerCase() его не убирает → INVALID_REQUEST_PARAMS
          // «price_currency must only contain alpha-numeric characters».
          price_currency: this.mapCurrency(params.priceCurrency),
          pay_currency: this.mapCurrency(payCurrency),
          order_id: params.orderId,
          ipn_callback_url: params.ipnCallbackUrl,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        throw new PaymentProviderError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      const d = asPspResponse<NOWPaymentsCreatePaymentResponse>(await res.json())
      const { paymentId, payAddress } = parseCreateResponse(d)
      if (!paymentId || !payAddress) {
        throw new PaymentProviderError(
          `unexpected shape: ${JSON.stringify({ paymentId, payAddress }).slice(0, 200)}`,
        )
      }
      this.logger.log(`NOWPayments payment created: ${paymentId}`)
      return {
        paymentId,
        payAddress,
        payAmount: String(d.pay_amount ?? ''),
        payCurrency: String(d.pay_currency ?? this.mapCurrency(payCurrency)),
        expirationEstimateDate: String(
          d.expiration_estimate_date ?? new Date(Date.now() + 3600_000).toISOString(),
        ),
      }
    } catch (e) {
      this.logger.error(`NOWPayments createPayment failed: ${errorMessage(e)}`)
      throw e
    }
  }

  async getPaymentStatus(
    paymentId: string,
  ): Promise<{ paymentStatus: string; actuallyPaid: string; outcomeAmount: string }> {
    const apiKey = this.assertApiKey()
    const res = await fetch(`${this.base()}/payment/${encodeURIComponent(paymentId)}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      // Тело ответа — единственное, что объясняет отказ (например AMOUNT_MINIMAL_ERROR
      // с конкретной суммой). Без него диагностика сводится к «HTTP 400».
      throw new PaymentProviderError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    const d = asPspResponse<NOWPaymentsPaymentStatusResponse>(await res.json())
    return {
      paymentStatus: String(d.payment_status ?? 'unknown'),
      actuallyPaid: String(d.actually_paid ?? '0'),
      outcomeAmount: String(d.outcome_amount ?? '0'),
    }
  }

  /**
   * GET /estimate — курс для maintenance-задачи update-rates (GAP-33/34).
   * Возвращает null, если API недоступен/курс некорректен — вызывающий
   * падает на fallback (константы DISPLAY_RUB_RATES), задача не роняется.
   */
  async estimate(params: {
    amount: string
    currencyFrom: string
    currencyTo: string
  }): Promise<{ estimatedAmount: string; source: string } | null> {
    if (!this.isProd() && !this.config.get<string>('NOWPAYMENTS_API_KEY')) {
      // Dev-stub: детерминированный «курс» из констант, чтобы задача была проходима без ключей
      const stub = DISPLAY_RUB_RATES[params.currencyFrom as keyof typeof DISPLAY_RUB_RATES]
      if (!stub) {
        return null
      }
      return { estimatedAmount: stub, source: 'np-dev-stub' }
    }
    try {
      const apiKey = this.assertApiKey()
      const qs = new URLSearchParams({
        amount: params.amount,
        currency_from: this.mapCurrency(params.currencyFrom),
        currency_to: this.mapCurrency(params.currencyTo),
      })
      const res = await fetch(`${this.base()}/estimate?${qs}`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        // См. getPaymentStatus: без тела 429/400 неотличимы друг от друга.
        throw new PaymentProviderError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      const d = asPspResponse<NOWPaymentsEstimateResponse>(await res.json())
      // Курс остаётся строкой: `String(Number(x))` на границе терял формат
      // ('1e-8' вместо '0.00000001') и точность — деньги/курсы number'ом не
      // гоняем (AI_DEVELOPMENT_RULES §1, гард G20). Decimal конструктор бросает
      // исключение на не-число — его перехватит catch ниже (null → fallback).
      const rawEstimatedAmount = String(d.estimated_amount ?? '')
      const estimatedAmount = new Decimal(rawEstimatedAmount)
      if (estimatedAmount.lte(0)) {
        throw new PaymentProviderError(`bad estimate shape: ${JSON.stringify(d).slice(0, 120)}`)
      }
      return { estimatedAmount: rawEstimatedAmount, source: 'nowpayments' }
    } catch (e) {
      this.logger.error(`NOWPayments estimate failed: ${errorMessage(e)}`)
      return null
    }
  }

  async getEstimatePrice(params: {
    amount: string
    currencyFrom: string
    currencyTo: string
  }): Promise<{ estimatedAmount: string }> {
    /**
     * Dev/STAGE-заглушка курса. Условие включения — `NODE_ENV !== 'production'`
     * И пустой `NOWPAYMENTS_API_KEY`, т.е. в прод-контуре недостижима: envSchema
     * (packages/shared-config/src/env.validation.ts) допускает NODE_ENV только из
     * {development|staging|production|test}, а prod-без-ключа и так падает на
     * assertApiKey (PAYMENT_PROVIDER_NOT_CONFIGURED/503).
     *
     * Курс берётся из DISPLAY_RUB_RATES (те же константы, что у dev-заглушки
     * `estimate` выше) вместо локального словаря: так ветки TON/TRX/LTC исчезают
     * сами собой — валют вне релизного набора в константах нет.
     *
     * Арифметика — Decimal, а не number: результат уходит в KYC-лимит
     * (CreateCryptoDepositUseCase → assertCanDeposit), т.е. это денежная
     * величина (AI_DEVELOPMENT_RULES §1, гард G20). `amount` к этому месту уже
     * прошёл regex-валидацию DTO (`^\d+(\.\d{1,8})?$`).
     */
    if (!this.isProd() && !this.config.get<string>('NOWPAYMENTS_API_KEY')) {
      const targetRateToRub = DISPLAY_RUB_RATES[params.currencyTo as DisplayCurrency]
      if (params.currencyFrom === 'RUB' && targetRateToRub) {
        return { estimatedAmount: new Decimal(params.amount).div(targetRateToRub).toFixed(8) }
      }
      const sourceRateToRub = DISPLAY_RUB_RATES[params.currencyFrom as DisplayCurrency]
      if (params.currencyTo === 'RUB' && sourceRateToRub) {
        return { estimatedAmount: new Decimal(params.amount).times(sourceRateToRub).toFixed(2) }
      }
      return { estimatedAmount: params.amount }
    }
    const apiKey = this.assertApiKey()
    const q = new URLSearchParams({
      amount: params.amount,
      currency_from: this.mapCurrency(params.currencyFrom),
      currency_to: this.mapCurrency(params.currencyTo),
    })
    const res = await fetch(`${this.base()}/estimate?${q.toString()}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200)
      throw new PaymentProviderError(`estimate HTTP ${res.status}: ${detail}`)
    }
    const d = asPspResponse<NOWPaymentsEstimateResponse>(await res.json())
    return { estimatedAmount: String(d.estimated_amount ?? params.amount) }
  }

  /**
   * IPN signature verification — dual-check (P0 #4, SECURITY_FIXES #4).
   *
   * NOWPayments подписывает IPN HMAC-SHA512 по КАНОНИЧЕСКОМУ JSON —
   * официальный сниппет из их док (Python):
   *   sorted payload keys (верхний уровень) → json.dumps(..., separators=(',',':'))
   *   → hmac-sha512(ipn_secret) → hex → заголовок x-nowpayments-sig.
   * Раньше мы проверяли HMAC по raw body — для реальных NOWPayments IPN
   * он НИКОГДА не совпадает (в подписи не raw-байты): депозиты не зачислялись.
   *
   * Алгоритм проверки:
   *   1. канонический (спека): parse → sort keys → compact JSON →
   *      не-ASCII экранируется \uXXXX по правилам ensure_ascii Python;
   *   2. raw-body HMAC (обратная совместимость, стоит 1 hash);
   * принимается ЛЮБОЙ из двух (секрет один и тот же — ослабления нет).
   *
   * Fail-closed: production без NOWPAYMENTS_IPN_SECRET — exception.
   */
  verifyIPN(rawBody: string, signature: string): boolean {
    const secret = this.config.get<string>('NOWPAYMENTS_IPN_SECRET')
    if (!secret) {
      if (this.isProd()) {
        throw new PaymentProviderNotConfiguredError('NOWPayments', 'NOWPAYMENTS_IPN_SECRET')
      }
      this.logger.error('NOWPAYMENTS_IPN_SECRET not set — rejecting IPN (fail-closed dev)')
      return false
    }
    if (!signature || !rawBody) {
      return false
    }
    // 1. Канонический вариант по спеке NOWPayments (Python-сниппет)
    try {
      const canonical = canonicalizeForNOWPayments(rawBody)
      const expected = createHmac('sha512', secret).update(canonical, 'utf8').digest('hex')
      if (safeEqualHex(signature, expected)) {
        return true
      }
      // 1b. PHP-флейвор: json_encode по умолчанию экранирует «/»
      const phpFlavor = canonical.replace(/\//g, '\\/')
      const expectedPhp = createHmac('sha512', secret).update(phpFlavor, 'utf8').digest('hex')
      if (safeEqualHex(signature, expectedPhp)) {
        return true
      }
    } catch {
      // невалидный JSON или ошибка сериализации — идём в raw-проверку
    }
    // 2. Raw-body HMAC (обратная совместимость)
    const expectedRaw = createHmac('sha512', secret).update(rawBody, 'utf8').digest('hex')
    return safeEqualHex(signature, expectedRaw)
  }
}

/**
 * Константное сравнение hex-подписи, регистронезависимое (заголовок
 * может прийти в верхнем регистре).
 */
function safeEqualHex(received: string, expected: string): boolean {
  try {
    const a = Buffer.from(received.toLowerCase())
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Канонический JSON по официальному сниппету NOWPayments (Python):
 *  - ключи верхнего уровня сортируются (sorted(data.items()));
 *  - разделители компактные (separators=(',', ':'));
 *  - ensure_ascii=True (дефолт Python): каждый не-ASCII символ → \uXXXX
 *    в нижнем регистре по UTF-16 кодам (астералы — суррогатными парами);
 *  - числа сохраняют ИСХОДНУЮ запись из тела (Python repr(10.0)='10.0',
 *    а JSON.parse+JSON.stringify дал бы '10' — и HMAC не сошёлся бы).
 * Управляющие символы JSON.stringify экранирует так же, как Python
 * (\b\f\n\r\t коротко, остальные <0x20 через \uXXXX); «/» НЕ экранируется
 * — совпадает с Python (в отличие от дефолтного PHP json_encode — такой
 * вариант проверяется отдельно в verifyIPN).
 *
 * Вход — СЫРОЙ текст тела (не распарсенный объект), чтобы сохранить токены чисел.
 */
export function canonicalizeForNOWPayments(rawBody: string): string {
  // числа → строковые маркеры (вне строк), чтобы JSON.parse не схлопнул 10.0 в 10
  const marked = markNumberTokens(rawBody)
  const parsed: unknown = JSON.parse(marked.text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // спека NOWPayments шлёт только плоские объекты; прочее — как есть
    return asciiEscape(JSON.stringify(parsed))
  }
  // type-confusion guard: если в теле есть СТРОКИ, неотличимые от наших
  // маркеров (вставили N, а нашли N+k) — значит часть «маркеров» пришла от
  // отправителя. Каноническую ветку пропускаем (verifyIPN проверит raw-HMAC).
  if (countMarkers(parsed) !== marked.inserted) {
    throw new PaymentProviderError('marker collision')
  }
  const obj = parsed as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key]
  }
  const s = JSON.stringify(sorted)
  // все маркеры наши (подтверждено подсчётом) → восстанавливаем исходные токены
  return asciiEscape(s.replace(/"\\u0000NUM:([^"\\]*)\\u0000"/g, '$1'))
}

const NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/

/** Полное совпадение строки-маркера (с реальными NUL) с валидным числом внутри. */
// NUL в маркере намеренный: реальный NOWPayments в строках NUL не шлёт,
// а guard по подсчёту маркеров ловит подделку (type-confusion). Литерал/строка
// с \u0000 ловит no-control-regex — собираем паттерн из кусков.
const NUL = String.fromCharCode(0)
const MARKER_VALUE = new RegExp(
  '^' + NUL + 'NUM:(-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)' + NUL + '$',
)

/** Глубокий подсчёт строк-маркеров в распарсенном объекте. */
function countMarkers(v: unknown): number {
  if (typeof v === 'string') {
    return MARKER_VALUE.test(v) ? 1 : 0
  }
  if (Array.isArray(v)) {
    return v.reduce((n: number, x) => n + countMarkers(x), 0)
  }
  if (v !== null && typeof v === 'object') {
    return Object.values(v).reduce((n: number, x) => n + countMarkers(x), 0)
  }
  return 0
}

/**
 * Обходит СЫРОЙ JSON-текст: вне строк оборачивает числовые токены в
 * строковые маркеры "\u0000NUM:<token>\u0000". Внутри строк (даты,
 * адреса) ничего не трогает — там числа легитимны как текст.
 * Возвращает текст и число вставленных маркеров (для type-confusion guard).
 */
function markNumberTokens(raw: string): { text: string; inserted: number } {
  let out = ''
  let inStr = false
  let i = 0
  let inserted = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (inStr) {
      if (ch === '\\') {
        out += ch + (raw[i + 1] ?? '')
        i += 2
        continue
      }
      if (ch === '"') {
        inStr = false
      }
      out += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
      i += 1
      continue
    }
    const m = NUMBER_TOKEN.exec(raw.slice(i))
    if (m) {
      out += '"\\u0000NUM:' + m[0] + '\\u0000"'
      inserted += 1
      i += m[0].length
      continue
    }
    out += ch
    i += 1
  }
  return { text: out, inserted }
}

/** ensure_ascii-экранирование поверх JSON.stringify. */
function asciiEscape(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)
    if (code !== undefined && code < 0x80) {
      out += ch
    } else {
      // астеральные символы: экранируем обе UTF-16 суррогатные единицы
      for (const unit of ch) {
        out += '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0')
      }
    }
  }
  return out
}
