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
    this.logger.log(`NOWPayments create ${params.priceAmount} ${params.priceCurrency} -> ${params.payCurrency}`)
    const payAmount = params.priceAmount // stub 1:1
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
  verifyIPN(_body: any, _signature: string): boolean { return true /* TODO HMAC with NOWPAYMENTS_IPN_SECRET */ }
}
