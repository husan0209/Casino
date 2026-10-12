import { createHmac, timingSafeEqual } from 'crypto'

import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'

import { AppError } from '@casino/shared-utils'

import { PaymentProviderError } from '../../domain/errors'
import {
  isRukassaMethod,
  type IRukassaClient,
  type RukassaCreatePayment,
} from '../../domain/payments.ports'

export type { RukassaCreatePayment }

export class PaymentProviderNotConfiguredError extends AppError {
  readonly code = 'PAYMENT_PROVIDER_NOT_CONFIGURED'
  readonly httpStatus = 503
  constructor(provider: string, keys: string) {
    super(`${provider}: отсутствуют обязательные ключи (${keys})`, { provider })
  }
}

const TIMEOUT_MS = 30_000 // TZ part 3 §5.3

/**
 * Rukassa HTTP client — TZ part 3 §5 (UC-PAY-01/02).
 *
 * Контракт — официальная страница «Разработчикам» (их документация API):
 *   POST https://lk.rukassa.io/api/v1/create     shop_id, token, order_id, amount, data
 *   POST https://lk.rukassa.io/api/v1/getPayInfo shop_id, token, id
 * Оба принимают form-urlencoded; авторизация — полями `shop_id` + `token` в теле,
 * НЕ заголовками. Ответ create: `{ id, hash, url }`, при отказе `{ error, message }`.
 *
 * Env:
 *   RUKASSA_SHOP_ID / RUKASSA_API_KEY — обязательны в production (fail-closed);
 *     `token` из их настроек мерчанта, он же ключ подписи уведомлений.
 *   RUKASSA_API_BASE — база (default https://lk.rukassa.io), если их хостинг сменится.
 *
 * URL коллбэка и редиректы в API НЕ передаются — их задают в кабинете мерчанта
 * («URL оповещения»), поэтому RUKASSA_WEBHOOK_URL/SUCCESS_URL/FAIL_URL из кода убраны.
 * Dev без ключей — лог-стаб, чтобы флоу проверялся без PSP.
 */
@Injectable()
export class RukassaClient implements IRukassaClient {
  private readonly logger = new Logger(RukassaClient.name)
  constructor(@Inject(ConfigService) private config: ConfigService) {}

  private isProd(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production'
  }

  private shopId(): string | undefined {
    return this.config.get<string>('RUKASSA_SHOP_ID')
  }

  /** Их `token` — API-токен из настроек мерчанта; он же ключ подписи уведомлений. */
  private apiToken(): string | undefined {
    return this.config.get<string>('RUKASSA_API_KEY')
  }

  private assertConfigured(): { base: string; shopId: string; token: string } {
    const shopId = this.shopId()
    const token = this.apiToken()
    if (!shopId || !token) {
      throw new PaymentProviderNotConfiguredError('Rukassa', 'RUKASSA_SHOP_ID, RUKASSA_API_KEY')
    }
    return {
      base: this.config.get<string>('RUKASSA_API_BASE') || 'https://lk.rukassa.io',
      shopId,
      token,
    }
  }

  async createPayment(
    params: RukassaCreatePayment,
  ): Promise<{ paymentId: string; paymentUrl: string }> {
    if (!this.isProd() && !this.shopId()) {
      return this.devStubPayment(params)
    }
    const { base, shopId, token } = this.assertConfigured()
    const form = new URLSearchParams({
      shop_id: shopId,
      token,
      order_id: params.orderId,
      amount: params.amount,
      currency: params.currency || 'RUB',
      data: params.data,
    })
    // Метод передаём только если он есть в их списке: наше `p2p` для Rukassa
    // не существует, а неизвестный method они читают как «показать один метод».
    if (isRukassaMethod(params.method)) {
      form.set('method', params.method)
    }
    const payload = await this.postForm(`${base}/api/v1/create`, form)
    // Сначала успешные поля: `error` у них бывает и `false`/`0` в успешном
    // ответе, а отказ без id/url мы всё равно отдаём их текстом сообщения.
    const paymentId = String(payload.id ?? '')
    const paymentUrl = String(payload.url ?? '')
    if (!paymentId || !paymentUrl) {
      throw new PaymentProviderError(this.refusalMessage(payload))
    }
    this.logger.log(`Rukassa order created: ${paymentId}`)
    return { paymentId, paymentUrl }
  }

  /** Локальный флоу-тест без PSP: платёжка «создана», ссылка ведёт на наш фронт. */
  private devStubPayment(params: RukassaCreatePayment): {
    paymentId: string
    paymentUrl: string
  } {
    this.logger.log(`Rukassa DEV-STUB create ${params.amount} order=${params.orderId}`)
    const webUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000'
    return {
      paymentId: `rk_${params.orderId}`,
      paymentUrl: `${webUrl}/wallet?deposit=pending`,
    }
  }

  async getPaymentStatus(paymentId: string): Promise<{ status: string; amount: string }> {
    const { base, shopId, token } = this.assertConfigured()
    const payload = await this.postForm(
      `${base}/api/v1/getPayInfo`,
      new URLSearchParams({ shop_id: shopId, token, id: paymentId }),
    )
    const status = String(payload.status ?? '')
    if (!status) {
      throw new PaymentProviderError(this.refusalMessage(payload))
    }
    return {
      status,
      // `in_amount` — оплачено по факту, `amount` — заявлено. Для сверки нужен
      // факт: недоплаченный платёж иначе выглядел бы оплаченным.
      amount: String(payload.in_amount ?? payload.amount ?? '0'),
    }
  }

  /** Отказ или неожиданная форма ответа: текст провайдера, но без токена внутри. */
  private refusalMessage(payload: Record<string, unknown>): string {
    const text = refusalText(payload) ?? `unexpected response shape: ${JSON.stringify(payload)}`
    return this.redactSecret(text).slice(0, 200)
  }

  /**
   * form-urlencoded POST: их пример на PHP использует http_build_query, JSON они
   * не принимают. external PSP payload — defensive parsing неизвестной формы.
   */
  private async postForm(url: string, form: URLSearchParams): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new PaymentProviderError(
          this.redactSecret(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`),
        )
      }
      return (await response.json()) as Record<string, unknown>
    } catch (e) {
      // TZ §5.4 UC-PAY-01 шаг 7: ошибка провайдера → наружу PAYMENT_PROVIDER_ERROR
      this.logger.error(`Rukassa ${url} failed: ${errorMessage(e)}`)
      throw e
    }
  }

  /**
   * Текст ответа провайдера попадает и в лог, и в сообщение ошибки. PHP-панели
   * иногда печатают `$_POST` эхом — а там `token`. Наружу он уходить не должен.
   */
  private redactSecret(text: string): string {
    const token = this.apiToken()
    if (!token || token.length < 4) {
      return text
    }
    return text.split(token).join('[redacted]')
  }

  /**
   * Подпись уведомления: `hash_hmac('sha256', id|createdDateTime|amount, токен)`
   * в заголовке `Signature`. Ключ — API-токен, отдельного webhook-секрета у
   * Rukassa нет. Fail-closed и в dev: без токена подпись неотличима от подделки.
   */
  verifyCallback(headers: Record<string, string>, body: Record<string, unknown>): boolean {
    const token = this.apiToken()
    if (!token) {
      if (this.isProd()) {
        throw new PaymentProviderNotConfiguredError('Rukassa', 'RUKASSA_API_KEY')
      }
      this.logger.error('RUKASSA_API_KEY not set — rejecting callback (fail-closed dev)')
      return false
    }
    const received = headers['signature'] || ''
    if (!received) {
      return false
    }
    return hexSignaturesEqual(received, this.expectedSignature(body, token))
  }

  private expectedSignature(body: Record<string, unknown>, token: string): string {
    const payload = [body.id, body.createdDateTime, body.amount]
      .map((value) => String(value ?? ''))
      .join('|')
    return createHmac('sha256', token).update(payload).digest('hex')
  }
}

/**
 * Их отказ: `{ error, message }`. `error: false`/`0` отказом не считаем — такие
 * значения всплывают в успешных ответах PHP-панелей.
 */
function refusalText(payload: Record<string, unknown>): string | null {
  if (!payload.error) {
    return null
  }
  return `error ${String(payload.error)}: ${String(payload.message ?? '')}`.slice(0, 200)
}

/** Сравнение с guard'ом по длине: timingSafeEqual бросает на разном размере буферов. */
function hexSignaturesEqual(received: string, expected: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(received) || received.length !== expected.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))
}
