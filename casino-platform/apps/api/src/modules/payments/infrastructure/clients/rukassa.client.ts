import { createHmac, timingSafeEqual } from 'crypto'

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'

import { AppError } from '@casino/shared-utils'

export class PaymentProviderNotConfiguredError extends AppError {
  readonly code = 'PAYMENT_PROVIDER_NOT_CONFIGURED'
  readonly httpStatus = 503
  constructor(provider: string, keys: string) {
    super(`${provider}: отсутствуют обязательные ключи (${keys})`, { provider })
  }
}

export interface RukassaCreatePayment {
  amount: string
  orderId: string
  method?: string
  webhookUrl: string
  successUrl: string
  failUrl: string
}

const TIMEOUT_MS = 30_000 // TZ part 3 §5.3

/**
 * Rukassa HTTP client — TZ part 3 §5 (UC-PAY-01/02).
 *
 * База и ключи — env:
 *   RUKASSA_API_BASE   (default https://pay.rukassa.is)
 *   RUKASSA_SHOP_ID / RUKASSA_API_KEY  — обязательны в production (fail-closed)
 *   RUKASSA_SECRET_KEY — секрет подписи webhook (HMAC-SHA256 "shop_id:order_id:amount")
 *
 * Если у конкретного мерчанта эндпоинты отличаются — правится через RUKASSA_API_BASE,
 * код не меняется. Dev без ключей работает на лог-стабе (флоу проверяем без PSP).
 */
/** Rukassa отдаёт разные имена полей в зависимости от версии API. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- external PSP payload (Rukassa), defensive parsing of unknown JSON shape
function pickPaymentFields(data: Record<string, any>): {
  paymentId: string
  paymentUrl: string
} {
  return {
    paymentId: String(data.payment_id ?? data.id ?? data.order_id ?? ''),
    paymentUrl: String(data.payment_url ?? data.url ?? data.location ?? ''),
  }
}

@Injectable()
export class RukassaClient {
  private readonly logger = new Logger(RukassaClient.name)
  constructor(private config: ConfigService) {}

  private isProd(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production'
  }

  private assertConfigured(): { base: string; shopId: string; apiKey: string } {
    const shopId = this.config.get<string>('RUKASSA_SHOP_ID')
    const apiKey = this.config.get<string>('RUKASSA_API_KEY')
    if (!shopId || !apiKey) {
      throw new PaymentProviderNotConfiguredError('Rukassa', 'RUKASSA_SHOP_ID, RUKASSA_API_KEY')
    }
    return {
      base: this.config.get<string>('RUKASSA_API_BASE') || 'https://pay.rukassa.is',
      shopId,
      apiKey,
    }
  }

  async createPayment(
    params: RukassaCreatePayment,
  ): Promise<{ paymentId: string; paymentUrl: string }> {
    if (!this.isProd() && !this.config.get<string>('RUKASSA_SHOP_ID')) {
      this.logger.log(`Rukassa DEV-STUB create ${params.amount} RUB order=${params.orderId}`)
      return {
        paymentId: `rk_${params.orderId}`,
        paymentUrl: `${params.successUrl}&stub=rukassa&order=${params.orderId}`,
      }
    }
    const { base, shopId, apiKey } = this.assertConfigured()
    try {
      const res = await fetch(`${base}/api/v1/order/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', shop_id: shopId, api_key: apiKey },
        body: JSON.stringify({
          order_id: params.orderId,
          amount: params.amount,
          currency: 'RUB',
          payment_method: params.method || undefined,
          success_url: params.successUrl,
          fail_url: params.failUrl,
          webhook_url: params.webhookUrl,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- external PSP payload (Rukassa /order/create), defensive parsing
      const data = (await res.json()) as Record<string, any>
      const { paymentId, paymentUrl } = pickPaymentFields(data)
      if (!paymentId || !paymentUrl) {
        throw new Error(`unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`)
      }
      this.logger.log(`Rukassa order created: ${paymentId}`)
      return { paymentId, paymentUrl }
    } catch (e) {
      // TZ §5.4 UC-PAY-01 шаг 7: ошибка провайдера → PR остаётся/становится failed, наверх PAYMENT_PROVIDER_ERROR
      this.logger.error(`Rukassa createPayment failed: ${errorMessage(e)}`)
      throw e
    }
  }

  async getPaymentStatus(paymentId: string): Promise<{ status: string; amount: string }> {
    if (!this.config.get<string>('RUKASSA_SHOP_ID')) {
      return { status: 'unknown', amount: '0' }
    }
    const { base, shopId, apiKey } = this.assertConfigured()
    const res = await fetch(`${base}/api/v1/order/status/${encodeURIComponent(paymentId)}`, {
      headers: { shop_id: shopId, api_key: apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- external PSP payload (Rukassa status), defensive parsing
    const d = (await res.json()) as Record<string, any>
    return {
      status: String(d.status ?? d.payment_status ?? 'unknown'),
      amount: String(d.amount ?? '0'),
    }
  }

  /**
   * Подпись вебхука: HMAC-SHA256(secret, "shop_id:order_id:amount"), заголовок x-signature (или body.sign).
   * Fail-closed: в production без RUKASSA_SECRET_KEY — исключение (старт невозможен по env.validation).
   */
  verifyCallback(headers: Record<string, string>, rawBody: unknown): boolean {
    const secret = this.config.get<string>('RUKASSA_SECRET_KEY')
    if (!secret) {
      return this.failWithoutSecret()
    }
    // Signature MUST come from the header only. Reading `body.sign` would
    // let an attacker bypass the signature check by simply including a
    // pre-computed `sign` field in the payload.
    const receivedSig: string = headers['x-signature'] || ''
    if (!receivedSig) {
      return false
    }
    const expected = this.expectedSignature(rawBody, secret)

    try {
      return timingSafeEqual(Buffer.from(receivedSig, 'hex'), Buffer.from(expected, 'hex'))
    } catch {
      return false
    }
  }

  /** Отбой без RUKASSA_SECRET_KEY: fail-closed и в dev (GAP-43: рантайм-приёмка). */
  private failWithoutSecret(): boolean {
    if (this.isProd()) {
      throw new PaymentProviderNotConfiguredError('Rukassa', 'RUKASSA_SECRET_KEY')
    }
    this.logger.error('RUKASSA_SECRET_KEY not set — rejecting callback (fail-closed dev)')
    return false
  }

  /** HMAC-SHA256 подпись для payload: shop_id:order_id:amount. */
  private expectedSignature(rawBody: unknown, secret: string): string {
    const shopId = this.config.get<string>('RUKASSA_SHOP_ID') || ''
    const body = (rawBody ?? {}) as Record<string, unknown>
    const orderId = String(body['order_id'] || body['merchant_order_id'] || '')
    const amount = String(body['amount'] || '')
    const payload = `${shopId}:${orderId}:${amount}`
    return createHmac('sha256', secret).update(payload).digest('hex')
  }
}
