import { CURRENCY_LIMITS, type CryptoCurrency, isSupportedCurrency } from '@casino/shared-config'

import { InvalidCurrencyError, InvalidDestinationError } from './errors'

/**
 * Релизный набор криптовалют платежа (TZ-02).
 *
 * Источник истины — тип `CryptoCurrency` из `@casino/shared-config`
 * (packages/shared-config/src/geo.config.ts:3): в релиз вошли ТОЛЬКО
 * `USDT_TRC20` и `BTC`, валюты `TON`/`TRX`/`LTC` из релиза убраны. Таблица
 * тикеров объявлена как `Record<CryptoCurrency, string>`, поэтому union покрыт
 * целиком на этапе компиляции: ветка маппинга «на валюту будущего» не может
 * появиться раньше, чем валюта появится в гео-конфиге, — мёртвых строк больше
 * нет ни при каком развитии набора.
 *
 * Набор НЕ расширяется через env: `envSchema`
 * (packages/shared-config/src/env.validation.ts) ключей выбора валют не
 * содержит, а справочник методов (`cryptoMethods()`) отдавает те же две
 * позиции. То есть TON/TRX/LTC — не сознательный запас, а расхождение, и
 * отклонение такой валюты — корректное поведение, а не потеря фичи.
 *
 * Регистр значим: внутренние коды — `UPPER_SNAKE`, сравнение точное. Строка
 * `'usdttrc20'` или `'btc'` — это не «та же валюта в другом регистре», а
 * неизвестный вход: ниже по потоку из неё собирался бы `pay_currency` провайдеру.
 */

/** Тикеры NOWPayments для релизных валют (`pay_currency`, `currency_from/to`). */
export const CRYPTO_PAY_CURRENCY_TICKERS: Record<CryptoCurrency, string> = {
  USDT_TRC20: 'usdttrc20',
  BTC: 'btc',
}

/**
 * Тот же набор списком: нужен и домену (проверка/отклонение), и presentation
 * (enum в DTO), чтобы второй whitelist не разъезжался с первым. Приведение к
 * non-empty tuple — требование сигнатуры `z.enum`, ключи `Object.keys` непусты
 * по построению: union `CryptoCurrency` непустой.
 */
export const RELEASE_CRYPTO_CURRENCIES = Object.keys(CRYPTO_PAY_CURRENCY_TICKERS) as [
  CryptoCurrency,
  ...CryptoCurrency[],
]

export function isReleaseCryptoCurrency(currency: string): currency is CryptoCurrency {
  return Object.prototype.hasOwnProperty.call(CRYPTO_PAY_CURRENCY_TICKERS, currency)
}

/**
 * Отклоняет валюту вне релизного набора стабильным `INVALID_CURRENCY` (422).
 * Вызывается ДО любого обращения к провайдеру (use-case и клиент — оба), чтобы
 * заявка в неподдерживаемой валюте не создавалась даже в dev-stub.
 * Вход в контекст ошибки кладём обрезанным — сообщение уходит наружу.
 */
export function assertReleaseCryptoCurrency(currency: string): CryptoCurrency {
  if (!isReleaseCryptoCurrency(currency)) {
    const safeCurrency = currency.slice(0, 32)
    throw new InvalidCurrencyError(`Currency ${safeCurrency} is not enabled for payments`, {
      currency: safeCurrency,
    })
  }
  return currency
}

/**
 * Формат денежной суммы: целая часть и до 8 знаков дробной (8 — минимум из
 * `USDT_TRC20`/BTC, где 1e-8 — сатоша). Экспортируется, чтобы DTO и use-case
 * проверяли ОДНО правило: второй regex в presentation однажды разъехался бы с
 * первым и мусорная сумма дошла бы до `new Decimal()`.
 */
export const MONEY_AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/

/**
 * Пределы вывода по валюте — из `CURRENCY_LIMITS` (гео-конфиг), а не из
 * тернарника в use-case.
 *
 * До этого `CreateWithdrawalUseCase` брал лимиты по принципу «RUB → 500/200000,
 * всё остальное → 0.001/999999», тогда как гео-конфиг задаёт
 * `USDT_TRC20: 20/20000` и `BTC: 0.0002/1`. То есть заявка на 0.001 USDT
 * проходила, а верхняя граница USDT была выше разрешённой в 50 раз — лимит на
 * вывод (он же рисковый/AML-контроль) фактически не действовал для крипты.
 * Валюта вне whitelist отклоняется здесь же: use-case больше не полагается на
 * то, что presentation обязательно проверил вход.
 */
export function withdrawalLimitsFor(currency: string): { min: string; max: string } {
  if (!isSupportedCurrency(currency)) {
    const safeCurrency = currency.slice(0, 32)
    throw new InvalidCurrencyError(`Currency ${safeCurrency} has no withdrawal limits`, {
      currency: safeCurrency,
    })
  }
  const limits = CURRENCY_LIMITS[currency]
  return { min: limits.withdrawMin, max: limits.withdrawMax }
}

/**
 * Реквизиты вывода по сети. Обнаружение чужой сети — потеря средств без
 * возврата, поэтому проверка fail-closed и ДО блокировки баланса.
 *
 * Набор объявлен как `Record<CryptoCurrency, RegExp>`: union покрыт целиком на
 * этапе компиляции, поэтому «адрес для валюты будущего» не заведётся молча.
 * Фиатные реквизиты (номер карты / телефон СБП) здесь не проверяются: их формат
 * определяется процессингом, а не сетью, и отклонять их этим модулем — значит
 * чинить не тот слой.
 */
const CRYPTO_ADDRESS_PATTERNS: Record<CryptoCurrency, RegExp> = {
  // Tron: base58, всегда начинается с 'T', длина 34.
  USDT_TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  // Bitcoin: legacy P2PKH/P2SH (base58, 26–35) и bech32/bech32m (`bc1`, строгий
  // нижний регистр, 27–90).
  BTC: /^(bc1[a-z0-9]{25,89}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
}

export function assertWithdrawalDestination(currency: string, destination: string): void {
  if (!isReleaseCryptoCurrency(currency)) {
    return
  }
  const pattern = CRYPTO_ADDRESS_PATTERNS[currency]
  if (!pattern.test(destination)) {
    throw new InvalidDestinationError(
      'Withdrawal destination does not match the currency network',
      {
        currency,
      },
    )
  }
}
