import { Injectable, Logger } from '@nestjs/common'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'
import { RukassaClient } from '../../infrastructure/clients/rukassa.client'
import { WalletFacade } from '../../../wallet/application/wallet.facade'
@Injectable()
export class ProcessRukassaWebhookUseCase {
  private logger = new Logger(ProcessRukassaWebhookUseCase.name)
  constructor(private repo: PaymentRequestRepository, private rukassa: RukassaClient, private wallet: WalletFacade) {}
  async execute(rawHeaders: any, rawBody: any, ip: string) {
    const cb = await this.repo.saveCallback({
      provider: 'rukassa',
      externalId: rawBody?.order_id || rawBody?.payment_id,
      rawHeaders, rawBody: JSON.stringify(rawBody), ipAddress: ip
    })
    try {
      if (!this.rukassa.verifyCallback(rawHeaders, rawBody)) {
        await this.repo.markCallbackProcessed(cb.id, 'invalid_signature')
        this.logger.warn('Rukassa invalid signature')
        return { ok: true }
      }
      const externalId = rawBody.order_id || rawBody.merchant_order_id || rawBody.payment_id
      if (!externalId) { await this.repo.markCallbackProcessed(cb.id, 'no_external_id'); return { ok: true } }
      // try find by externalId or by payment_request.id
      let pr = await this.repo.findByExternalId(externalId, 'rukassa')
      if (!pr) pr = await this.repo.findById(externalId)
      if (!pr) { await this.repo.markCallbackProcessed(cb.id, 'payment_request_not_found'); return { ok: true } }
      if (pr.status === 'completed') { await this.repo.markCallbackProcessed(cb.id, 'duplicate'); return { ok: true } }
      const status = (rawBody.status || rawBody.state || '').toLowerCase()
      const success = ['paid','success','completed','confirm'].some(s => status.includes(s))
      if (success) {
        await this.wallet.credit({
          userId: pr.userId,
          currency: 'RUB' as any,
          amount: pr.amount.toString(),
          type: 'DEPOSIT',
          idempotencyKey: 'deposit_' + pr.id,
          description: 'Пополнение через Rukassa',
          metadata: { provider: 'rukassa', external_id: externalId }
        })
        await this.repo.updateStatus(pr.id, 'completed', { completedAt: new Date(), externalStatus: status })
      } else if (status.includes('fail') || status.includes('cancel')) {
        await this.repo.updateStatus(pr.id, 'failed', { externalStatus: status })
      } else {
        await this.repo.updateStatus(pr.id, 'processing', { externalStatus: status })
      }
      await this.repo.markCallbackProcessed(cb.id, 'ok')
      return { ok: true }
    } catch(e:any) {
      this.logger.error('Rukassa webhook err ' + e.message)
      await this.repo.markCallbackProcessed(cb.id, 'error: ' + e.message)
      return { ok: true } // always 200 to provider
    }
  }
}
