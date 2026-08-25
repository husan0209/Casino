import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, timingSafeEqual } from 'crypto'
import { PaymentProviderNotConfiguredError } from './rukassa.client'

const MAP: Record<string, string> = {
  USDT_TRC20: 'usdttrc20',
  BTC: 'btc',
  TON: 'ton',
  TRX: 'trx',
  LTC: 'ltc',
  RUB: 'rub',
}

const TIMEOUT_MS = 30_000

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
export class NOWPaymentsClient {
  private readonly logger = new Logger(NOWPaymentsClient.name)
  constructor(private config: ConfigService) {}

  private isProd(): boolean { return this.config.get<string>('NODE_ENV') === 'production' }

  private assertApiKey(): string {
    const key = this.config.get<string>('NOWPAYMENTS_API_KEY')
    if (!key) throw new PaymentProviderNotConfiguredError('NOWPayments', 'NOWPAYMENTS_API_KEY')
    return key
  }

  private base(): string {
    return this.config.get<string>('NOWPAYMENTS_API_BASE') || 'https://api.nowpayments.io/v1'
  }

  mapCurrency(ours: string) { return MAP[ours] || ours.toLowerCase() }

  async createPayment(params: { priceAmount: string; priceCurrency: string; payCurrency: string; orderId: string; ipnCallbackUrl: string }) {
    if (!this.isProd() && !this.config.get<string>('NOWPAYMENTS_API_KEY')) {
      this.logger.log(`NOWPayments DEV-STUB create ${params.priceAmount} ${params.priceCurrency}->${params.payCurrency} order=${params.orderId}`)
      const payAmount = params.priceAmount
      return {
        paymentId: `np_${params.orderId}`,
        payAddress: 'TX' + params.orderId.replace(/-/g, '').slice(0, 30),
        payAmount,
        payCurrency: this.mapCurrency(params.payCurrency),
        expirationEstimateDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }
    }
    const apiKey = this.assertApiKey()
    try {
      const res = await fetch(`${this.base()}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          price_amount: Number(params.priceAmount),
          price_currency: params.priceCurrency.toLowerCase(),
          pay_currency: this.mapCurrency(params.payCurrency),
          order_id: params.orderId,
          ipn_callback_url: params.ipnCallbackUrl,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const d = (await res.json()) as Record<string, any>
      const paymentId = String(d.payment_id ?? '')
      const payAddress = String(d.pay_address ?? '')
      if (!paymentId || !payAddress) throw new Error(`unexpected shape: ${JSON.stringify(d).slice(0, 200)}`)
      this.logger.log(`NOWPayments payment created: ${paymentId}`)
      return {
        paymentId,
        payAddress,
        payAmount: String(d.pay_amount ?? ''),
        payCurrency: String(d.pay_currency ?? this.mapCurrency(params.payCurrency)),
        expirationEstimateDate: String(d.expiration_estimate_date ?? new Date(Date.now() + 3600_000).toISOString()),
      }
    } catch (e: any) {
      this.logger.error(`NOWPayments createPayment failed: ${e?.message}`)
      throw e
    }
  }

  async getPaymentStatus(paymentId: string): Promise<{ paymentStatus: string; actuallyPaid: string; outcomeAmount: string }> {
    const apiKey = this.assertApiKey()
    const res = await fetch(`${this.base()}/payment/${encodeURIComponent(paymentId)}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = (await res.json()) as Record<string, any>
    return {
      paymentStatus: String(d.payment_status ?? 'unknown'),
      actuallyPaid: String(d.actually_paid ?? '0'),
      outcomeAmount: String(d.outcome_amount ?? '0'),
    }
  }

  async getEstimatePrice(params: { amount: string; currencyFrom: string; currencyTo: string }): Promise<{ estimatedAmount: string }> {
    // Dev без ключа: прежние захардкоженные курсы, чтобы флоу был проходим
    if (!this.isProd() && !this.config.get<string>('NOWPAYMENTS_API_KEY')) {
      const rates: Record<string, number> = { USDT_TRC20: 92.5, BTC: 8500000, TON: 450, TRX: 11.3, LTC: 7800 }
      const from = params.currencyFrom; const to = params.currencyTo
      if (from === 'RUB' && rates[to]) return { estimatedAmount: (parseFloat(params.amount) / rates[to]).toFixed(8) }
      if (to === 'RUB' && rates[from]) return { estimatedAmount: (parseFloat(params.amount) * rates[from]).toFixed(2) }
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
    if (!res.ok) throw new Error(`estimate HTTP ${res.status}`)
    const d = (await res.json()) as { estimated_amount?: number | string }
    return { estimatedAmount: String(d.estimated_amount ?? params.amount) }
  }

  /**
   * IPN signature verification.
   *
   * IMPORTANT: HMAC must be computed against the RAW request body bytes
   * (captured by express.json({ verify }) in main.ts), NOT against a
   * re-serialised JSON object. Re-serialised JSON differs from the
   * original in key order, whitespace, and number formatting, which
   * would reject legitimate webhooks.
   *
   * The `body` argument is kept for logging/fallback only — never use it
   * for the HMAC computation.
   *
   * Fail-closed: production without NOWPAYMENTS_IPN_SECRET — exception.
   */
  verifyIPN(rawBody: string, signature: string): boolean {
    const secret = this.config.get<string>('NOWPAYMENTS_IPN_SECRET')
    if (!secret) {
      if (this.isProd()) throw new PaymentProviderNotConfiguredError('NOWPayments', 'NOWPAYMENTS_IPN_SECRET')
      this.logger.error('NOWPAYMENTS_IPN_SECRET not set — rejecting IPN (fail-closed dev)')
      return false
    }
    if (!signature) return false
    if (!rawBody) return false

    const expected = createHmac('sha512', secret).update(rawBody, 'utf8').digest('hex')

    try {
      const a = Buffer.from(signature.toLowerCase())
      const b = Buffer.from(expected)
      return a.length === b.length && timingSafeEqual(a, b)
    } catch {
      return false
    }
  }
}
