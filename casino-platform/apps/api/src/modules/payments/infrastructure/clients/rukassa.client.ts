import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, timingSafeEqual } from 'crypto'

export interface RukassaCreatePayment {
  amount: string; orderId: string; method?: string; webhookUrl: string; successUrl: string; failUrl: string
}

@Injectable()
export class RukassaClient {
  private readonly logger = new Logger(RukassaClient.name)
  constructor(private config: ConfigService) {}
  async createPayment(params: RukassaCreatePayment): Promise<{ paymentId: string; paymentUrl: string }> {
    const env = this.config.get('NODE_ENV')
    if (env === 'production') {
      throw new Error('RUKASSA_CREATE_PAYMENT_NOT_IMPLEMENTED. Rukassa integration is not yet implemented for real payments.')
    }

    const shopId = this.config.get('RUKASSA_SHOP_ID') || 'dev_shop'
    this.logger.log(`Rukassa create ${params.amount} RUB order=${params.orderId}`)
    const paymentId = `rk_${params.orderId}`
    const paymentUrl = `${params.successUrl}&stub=rukassa&order=${params.orderId}`
    return { paymentId, paymentUrl }
  }

  /**
   * Verify Rukassa callback signature.
   * Rukassa signs: HMAC-SHA256(secret, merchant_id + ':' + order_id + ':' + amount)
   * Header: x-signature  (or sign field in body)
   * Fail-closed: throws in production without implementation.
   */
  verifyCallback(headers: Record<string, string>, body: any): boolean {
    const env = this.config.get('NODE_ENV')
    if (env === 'production') {
      throw new Error('RUKASSA_SIGNATURE_VERIFIER_NOT_IMPLEMENTED. Cannot verify Rukassa callbacks in production without complete integration.')
    }

    const secret = this.config.get<string>('RUKASSA_SECRET_KEY')
    if (!secret) {
      this.logger.error('RUKASSA_SECRET_KEY not set — rejecting callback (fail-closed)')
      return false
    }
    const receivedSig: string = headers['x-signature'] || body?.sign || ''
    if (!receivedSig) return false

    const shopId = this.config.get('RUKASSA_SHOP_ID') || ''
    const orderId = String(body?.order_id || body?.merchant_order_id || '')
    const amount  = String(body?.amount || '')
    const payload = `${shopId}:${orderId}:${amount}`
    const expected = createHmac('sha256', secret).update(payload).digest('hex')

    try {
      return timingSafeEqual(Buffer.from(receivedSig, 'hex'), Buffer.from(expected, 'hex'))
    } catch {
      return false
    }
  }
}

