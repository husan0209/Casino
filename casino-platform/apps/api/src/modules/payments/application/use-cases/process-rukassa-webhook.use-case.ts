import { Injectable, Logger } from '@nestjs/common'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'
import { RukassaClient } from '../../infrastructure/clients/rukassa.client'
import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { UsersFacade } from '../../../users/facade/users.facade'
import { classifyPaymentStatus } from '../../domain/payment-status'

@Injectable()
export class ProcessRukassaWebhookUseCase {
  private logger = new Logger(ProcessRukassaWebhookUseCase.name)
  constructor(
    private repo: PaymentRequestRepository,
    private rukassa: RukassaClient,
    private wallet: WalletFacade,
    private users: UsersFacade,
  ) {}
  async execute(rawHeaders: Record<string, string>, body: any, rawBody: string, ip: string) {
    // Store the EXACT raw body bytes the provider signed. If we ever need to
    // re-verify or investigate a dispute, we have the original payload.
    const cb = await this.repo.saveCallback({
      provider: 'rukassa',
      externalId: body?.order_id || body?.payment_id,
      rawHeaders, rawBody, ipAddress: ip
    })
    try {
      if (!this.rukassa.verifyCallback(rawHeaders, body)) {
        await this.repo.markCallbackProcessed(cb.id, 'invalid_signature')
        this.logger.warn('Rukassa invalid signature')
        return { ok: true }
      }
      const externalId = body.order_id || body.merchant_order_id || body.payment_id
      if (!externalId) { await this.repo.markCallbackProcessed(cb.id, 'no_external_id'); return { ok: true } }
      // try find by externalId or by payment_request.id
      let pr = await this.repo.findByExternalId(externalId, 'rukassa')
      if (!pr) pr = await this.repo.findById(externalId)
      if (!pr) { await this.repo.markCallbackProcessed(cb.id, 'payment_request_not_found'); return { ok: true } }
      if (pr.status === 'completed') { await this.repo.markCallbackProcessed(cb.id, 'duplicate'); return { ok: true } }
      const status = (body.status || body.state || '').toString()
      const outcome = classifyPaymentStatus(status)
      if (outcome === 'success') {
        const currency = pr.currency || 'RUB'
        await this.wallet.credit({
          userId: pr.userId,
          currency: currency as any,
          amount: pr.amount.toString(),
          type: 'DEPOSIT',
          idempotencyKey: 'deposit_' + pr.id,
          description: 'Пополнение через Rukassa',
          metadata: { provider: 'rukassa', external_id: externalId }
        })
        await this.users.onDepositCompleted(pr.userId, currency, pr.method || 'card')
        await this.repo.updateStatus(pr.id, 'completed', { completedAt: new Date(), externalStatus: status })
      } else if (outcome === 'failure') {
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
