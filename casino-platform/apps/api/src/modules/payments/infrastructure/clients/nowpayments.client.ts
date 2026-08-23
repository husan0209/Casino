import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac } from 'crypto'

const MAP: Record<string,string> = {
  USDT_TRC20: 'usdttrc20',
  BTC: 'btc',
  TON: 'ton',
  TRX: 'trx',
  LTC: 'ltc',
  RUB: 'rub',
}

@Injectable()
export class NOWPaymentsClient {
  private readonly logger = new Logger(NOWPaymentsClient.name)
  constructor(private config: ConfigService) {}
  mapCurrency(ours: string) { return MAP[ours] || ours.toLowerCase() }

  async createPayment(params: { priceAmount: string; priceCurrency: string; payCurrency: string; orderId: string; ipnCallbackUrl: string }) {
    const env = this.config.get('NODE_ENV')
    if (env === 'production') {
      throw new Error('NOWPAYMENTS_CREATE_PAYMENT_NOT_IMPLEMENTED. NOWPayments integration is not yet implemented for real payments.')
    }

    this.logger.log(`NOWPayments create ${params.priceAmount} ${params.priceCurrency} -> ${params.payCurrency}`)
    const payAmount = params.priceAmount
    return {
      paymentId: `np_${params.orderId}`,
      payAddress: 'TX' + params.orderId.replace(/-/g,'').slice(0,30),
      payAmount,
      payCurrency: this.mapCurrency(params.payCurrency),
      expirationEstimateDate: new Date(Date.now() + 60*60*1000).toISOString(),
    }
  }
  async getEstimatePrice(params: { amount: string; currencyFrom: string; currencyTo: string }) {
    // stub rates
    const rates: Record<string, number> = { USDT_TRC20: 92.5, BTC: 8500000, TON: 450, TRX: 11.3, LTC: 7800 }
    const from = params.currencyFrom
    const to = params.currencyTo
    if (from === 'RUB' && rates[to]) return { estimatedAmount: (parseFloat(params.amount) / rates[to]).toFixed(8) }
    if (to === 'RUB' && rates[from]) return { estimatedAmount: (parseFloat(params.amount) * rates[from]).toFixed(2) }
    return { estimatedAmount: params.amount }
  }
  /**
   * Verify NOWPayments IPN signature.
   * NOWPayments signs: HMAC-SHA512(ipn_secret, sorted_payload_string)
   * Header: x-nowpayments-sig
   * Fail-closed: throws in production without implementation.
   */
  verifyIPN(body: any, signature: string): boolean {
    const env = this.config.get('NODE_ENV')
    if (env === 'production') {
      throw new Error('NOWPAYMENTS_SIGNATURE_VERIFIER_NOT_IMPLEMENTED. Cannot verify NOWPayments IPN in production without complete integration.')
    }

    const secret = this.config.get<string>('NOWPAYMENTS_IPN_SECRET')
    if (!secret) {
      this.logger.error('NOWPAYMENTS_IPN_SECRET not set — rejecting IPN (fail-closed)')
      return false
    }
    if (!signature) return false

    const sortedBody = Object.keys(body)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => { acc[key] = body[key]; return acc }, {})
    const payload = JSON.stringify(sortedBody)
    const expected = createHmac('sha512', secret).update(payload).digest('hex')

    try {
      const { timingSafeEqual } = require('crypto')
      return timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(expected.toLowerCase()))
    } catch {
      return false
    }
  }
}
