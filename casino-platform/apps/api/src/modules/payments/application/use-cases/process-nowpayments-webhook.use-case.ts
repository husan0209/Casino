import { Injectable, Logger } from '@nestjs/common'
import { errorMessage } from '@/common/utils/error-message'


import { UsersFacade } from '@modules/users/facade/users.facade'
import { WalletFacade } from '@modules/wallet/application/wallet.facade'

import type { Currency } from '@casino/shared-types'

import { NOWPaymentsClient } from '../../infrastructure/clients/nowpayments.client'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'

/** IPN-запрос провайдера: заголовки, разобранный JSON, оригинальные байты тела и IP. */
export interface ProcessNowPaymentsWebhookInput {
  rawHeaders: Record<string, string>
  body: any
  rawBody: string
  ip: string
}

@Injectable()
export class ProcessNOWPaymentsWebhookUseCase {
  private logger = new Logger(ProcessNOWPaymentsWebhookUseCase.name)
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    private repo: PaymentRequestRepository,
    private np: NOWPaymentsClient,
    private wallet: WalletFacade,
    private users: UsersFacade,
  ) {}
  async execute(input: ProcessNowPaymentsWebhookInput) {
    const { rawHeaders, body, rawBody, ip } = input
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
      await this.applyPaymentStatus(pr, paymentStatus, body)
      await this.repo.markCallbackProcessed(cb.id, 'ok')
      return { ok: true }
    } catch (e) {
      this.logger.error('NOWPayments IPN err ' + errorMessage(e))
      await this.repo.markCallbackProcessed(cb.id, 'error: ' + errorMessage(e))
      return { ok: true }
    }
  }

  /** finished/confirmed -> зачисление; failed/expired/refunded -> closed-статусы; прочее -> processing. */
  private async applyPaymentStatus(
    pr: { id: string; userId: string; status: string; currency: string; amount: { toString(): string } },
    paymentStatus: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- NOWPayments IPN payload, body поля читаются через String()/|| fallback
    body: Record<string, any>,
  ): Promise<void> {
    if (['finished', 'confirmed'].includes(paymentStatus)) {
      await this.creditCryptoDeposit(pr, body)
    } else if (['failed', 'expired', 'refunded'].includes(paymentStatus)) {
      await this.repo.updateStatus(pr.id, paymentStatus === 'expired' ? 'expired' : 'failed', {
        externalStatus: paymentStatus,
      })
    } else {
      await this.repo.updateStatus(pr.id, 'processing', { externalStatus: paymentStatus })
    }
  }

  private async creditCryptoDeposit(
    pr: { id: string; userId: string; currency: string; amount: { toString(): string } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- NOWPayments IPN payload, body поля читаются через String()/|| fallback
    body: Record<string, any>,
  ): Promise<void> {
    const actuallyPaid = body.actually_paid || body.pay_amount || pr.amount.toString()
    await this.wallet.credit({
      userId: pr.userId,
      currency: pr.currency as Currency,
      amount: String(actuallyPaid),
      type: 'DEPOSIT',
      // GAP-28 (defense-in-depth): ключ от external_id провайдера — повторная доставка
      // IPN по тому же payment_id не зачислит дважды.
      idempotencyKey: 'deposit_nowpayments_' + String(body.payment_id),
      description: 'Крипто-пополнение через NOWPayments',
      metadata: {
        provider: 'nowpayments',
        external_id: String(body.payment_id),
        actually_paid: actuallyPaid,
      },
    })
    const cryptoMethod = pr.currency === 'BTC' ? 'btc' : 'usdt_trc20'
    await this.users.onDepositCompleted(pr.userId, pr.currency, cryptoMethod)
    await this.repo.updateStatus(pr.id, 'completed', {
      completedAt: new Date(),
      externalStatus: body.payment_status,
    })
  }
}
