import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac } from 'crypto'

export interface RukassaCreatePayment {
  amount: string; orderId: string; method?: string; webhookUrl: string; successUrl: string; failUrl: string
}

@Injectable()
export class RukassaClient {
  private readonly logger = new Logger(RukassaClient.name)
  constructor(private config: ConfigService) {}
  async createPayment(params: RukassaCreatePayment): Promise<{ paymentId: string; paymentUrl: string }> {
    const shopId = this.config.get('RUKASSA_SHOP_ID') || 'dev_shop'
    // STUB for MVP – in prod: POST https://lk.rukassa.is/api/v1/create
    this.logger.log(`Rukassa create ${params.amount} RUB order=${params.orderId}`)
    const paymentId = `rk_${params.orderId}`
    const paymentUrl = `${params.successUrl}&stub=rukassa&order=${params.orderId}`
    return { paymentId, paymentUrl }
  }
  verifyCallback(_headers: any, body: any): boolean {
    // TODO: HMAC verify with RUKASSA_SECRET_KEY
    // const sign = headers['x-signature']; const expected = hmac(...)
    return true
  }
}
