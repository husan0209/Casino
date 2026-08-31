import { Injectable, Logger } from '@nestjs/common'

import type { Currency } from '@casino/shared-types'

import { UsersFacade } from '../../../users/facade/users.facade'
import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { NOWPaymentsClient } from '../../infrastructure/clients/nowpayments.client'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'

@Injectable()
export class ProcessNOWPaymentsWebhookUseCase {
  private logger = new Logger(ProcessNOWPaymentsWebhookUseCase.name)
  constructor(
    private repo: PaymentRequestRepository,
    private np: NOWPaymentsClient,
    private wallet: WalletFacade,
    private users: UsersFacade,
  ) {}
  async execute(rawHeaders: Record<string, string>, body: any, rawBody: string, ip: string) {
    const signature = rawHeaders['x-nowpayments-sig'] || ''
    // Store the exact raw body bytes for forensics and re-verification.
    const cb = await this.repo.saveCallback({
      provider: 'nowpayments',
      externalId: String(body.payment_id || body.order_id || ''),
      rawHeaders,
      rawBody,
      ipAddress: ip,
    })
    try {
      // HMAC must be verified against the raw body bytes, not the re-serialised JSON.
      if (!this.np.verifyIPN(rawBody, signature)) {
        await this.repo.markCallbackProcessed(cb.id, 'invalid_signature')
        return { ok: true }
      }
      const paymentId = String(body.payment_id)
      const paymentStatus = String(body.payment_status || '').toLowerCase()
      const pr = await this.repo.findByExternalId(paymentId, 'nowpayments')
      if (!pr) {
        await this.repo.markCallbackProcessed(cb.id, 'not_found')
        return { ok: true }
      }
      if (pr.status === 'completed') {
        await this.repo.markCallbackProcessed(cb.id, 'duplicate')
        return { ok: true }
      }
      if (['finished', 'confirmed'].includes(paymentStatus)) {
        const actuallyPaid = body.actually_paid || body.pay_amount || pr.amount.toString()
        await this.wallet.credit({
          userId: pr.userId,
          currency: pr.currency as Currency,
          amount: String(actuallyPaid),
          type: 'DEPOSIT',
          idempotencyKey: 'deposit_' + pr.id,
          description: 'Крипто-пополнение через NOWPayments',
          metadata: {
            provider: 'nowpayments',
            external_id: paymentId,
            actually_paid: actuallyPaid,
          },
        })
        const cryptoMethod = pr.currency === 'BTC' ? 'btc' : 'usdt_trc20'
        await this.users.onDepositCompleted(pr.userId, pr.currency, cryptoMethod)
        await this.repo.updateStatus(pr.id, 'completed', {
          completedAt: new Date(),
          externalStatus: paymentStatus,
        })
      } else if (['failed', 'expired', 'refunded'].includes(paymentStatus)) {
        await this.repo.updateStatus(pr.id, paymentStatus === 'expired' ? 'expired' : 'failed', {
          externalStatus: paymentStatus,
        })
      } else {
        await this.repo.updateStatus(pr.id, 'processing', { externalStatus: paymentStatus })
      }
      await this.repo.markCallbackProcessed(cb.id, 'ok')
      return { ok: true }
    } catch (e: any) {
      this.logger.error('NOWPayments IPN err ' + e.message)
      await this.repo.markCallbackProcessed(cb.id, 'error: ' + e.message)
      return { ok: true }
    }
  }
}
