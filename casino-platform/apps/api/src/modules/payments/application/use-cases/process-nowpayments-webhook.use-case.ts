import { Injectable, Logger } from '@nestjs/common'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'
import { NOWPaymentsClient } from '../../infrastructure/clients/nowpayments.client'
import { WalletFacade } from '../../../wallet/application/wallet.facade'
@Injectable()
export class ProcessNOWPaymentsWebhookUseCase {
  private logger = new Logger(ProcessNOWPaymentsWebhookUseCase.name)
  constructor(private repo: PaymentRequestRepository, private np: NOWPaymentsClient, private wallet: WalletFacade) {}
  async execute(rawHeaders: any, rawBody: any, ip: string) {
    const signature = rawHeaders['x-nowpayments-sig'] || ''
    const cb = await this.repo.saveCallback({
      provider: 'nowpayments',
      externalId: String(rawBody.payment_id || rawBody.order_id || ''),
      rawHeaders, rawBody: JSON.stringify(rawBody), ipAddress: ip
    })
    try {
      if (!this.np.verifyIPN(rawBody, signature)) {
        await this.repo.markCallbackProcessed(cb.id, 'invalid_signature')
        return { ok: true }
      }
      const paymentId = String(rawBody.payment_id)
      const paymentStatus = String(rawBody.payment_status || '').toLowerCase()
      const pr = await this.repo.findByExternalId(paymentId, 'nowpayments')
      if (!pr) { await this.repo.markCallbackProcessed(cb.id, 'not_found'); return { ok: true } }
      if (pr.status === 'completed') { await this.repo.markCallbackProcessed(cb.id, 'duplicate'); return { ok: true } }
      if (['finished','confirmed'].includes(paymentStatus)) {
        const actuallyPaid = rawBody.actually_paid || rawBody.pay_amount || pr.amount.toString()
        await this.wallet.credit({
          userId: pr.userId,
          currency: pr.currency as any,
          amount: String(actuallyPaid),
          type: 'DEPOSIT',
          idempotencyKey: 'deposit_' + pr.id,
          description: 'Крипто-пополнение через NOWPayments',
          metadata: { provider: 'nowpayments', external_id: paymentId, actually_paid: actuallyPaid }
        })
        await this.repo.updateStatus(pr.id, 'completed', { completedAt: new Date(), externalStatus: paymentStatus })
      } else if (['failed','expired','refunded'].includes(paymentStatus)) {
        await this.repo.updateStatus(pr.id, paymentStatus === 'expired' ? 'expired' : 'failed', { externalStatus: paymentStatus })
      } else {
        await this.repo.updateStatus(pr.id, 'processing', { externalStatus: paymentStatus })
      }
      await this.repo.markCallbackProcessed(cb.id, 'ok')
      return { ok: true }
    } catch(e:any) {
      this.logger.error('NOWPayments IPN err ' + e.message)
      await this.repo.markCallbackProcessed(cb.id, 'error: ' + e.message)
      return { ok: true }
    }
  }
}
