import { Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { UsersFacade } from '@modules/users/facade/users.facade'
import { WalletFacade } from '@modules/wallet/application/wallet.facade'

import { type Currency } from '@casino/shared-types'

import { classifyPaymentStatus } from '../../domain/payment-status'
import { RukassaClient } from '../../infrastructure/clients/rukassa.client'
import { type PaymentRequest, PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'

/** Rukassa отдаёт id платежа в разных полях в зависимости от сценария. */
function pickExternalId(body: Record<string, unknown>): string {
  return String(body.order_id || body.merchant_order_id || body.payment_id || '')
}

/** Статус платежа: status (v1) либо state (старые интеграции). */
function pickStatus(body: Record<string, unknown>): string {
  return String(body.status || body.state || '')
}

/** IPN-запрос провайдера: заголовки, разобранный JSON, оригинальные байты тела и IP. */
export interface ProcessRukassaWebhookInput {
  rawHeaders: Record<string, string>
  body: Record<string, unknown>
  rawBody: string
  ip: string
}

@Injectable()
export class ProcessRukassaWebhookUseCase {
  private logger = new Logger(ProcessRukassaWebhookUseCase.name)
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    private repo: PaymentRequestRepository,
    private rukassa: RukassaClient,
    private wallet: WalletFacade,
    private users: UsersFacade,
  ) {}
  async execute(input: ProcessRukassaWebhookInput): Promise<{ ok: boolean; }> {
    const { rawHeaders, body, rawBody, ip } = input
    // Store the EXACT raw body bytes the provider signed. If we ever need to
    // re-verify or investigate a dispute, we have the original payload.
    const cb = await this.repo.saveCallback({
      provider: 'rukassa',
      externalId: String(body['order_id'] ?? body['payment_id'] ?? ''),
      rawHeaders,
      rawBody,
      ipAddress: ip,
    })
    try {
      if (!this.rukassa.verifyCallback(rawHeaders, body)) {
        await this.repo.markCallbackProcessed(cb.id, 'invalid_signature')
        this.logger.warn('Rukassa invalid signature')
        return { ok: true }
      }
      const externalId = pickExternalId(body)
      if (!externalId) {
        await this.repo.markCallbackProcessed(cb.id, 'no_external_id')
        return { ok: true }
      }
      const pr = await this.resolvePaymentRequest(externalId)
      if (!pr) {
        await this.repo.markCallbackProcessed(cb.id, 'payment_request_not_found')
        return { ok: true }
      }
      if (pr.status === 'completed') {
        await this.repo.markCallbackProcessed(cb.id, 'duplicate')
        return { ok: true }
      }
      const status = pickStatus(body)
      await this.applyOutcome(pr, status, externalId)
      await this.repo.markCallbackProcessed(cb.id, 'ok')
      return { ok: true }
    } catch (e) {
      this.logger.error('Rukassa webhook err ' + errorMessage(e))
      await this.repo.markCallbackProcessed(cb.id, 'error: ' + errorMessage(e))
      return { ok: true } // always 200 to provider
    }
  }

  /** Платёжка: сначала по external_id провайдера, затем по id платежа. */
  private async resolvePaymentRequest(externalId: string): Promise<PaymentRequest | null> {
    const pr = await this.repo.findByExternalId(externalId, 'rukassa')
    if (pr) {
      return pr
    }
    return this.repo.findById(externalId)
  }

  /** Успех -> зачисление депозита; failure -> failed; остальное -> processing. */
  private async applyOutcome(
    pr: { id: string; userId: string; status: string; currency: string | null; amount: { toString(): string }; method: string | null },
    status: string,
    externalId: string,
  ): Promise<void> {
    const outcome = classifyPaymentStatus(status)
    if (outcome === 'success') {
      const currency = pr.currency || 'RUB'
      await this.wallet.credit({
        userId: pr.userId,
        currency: currency as Currency,
        amount: pr.amount.toString(),
        type: 'DEPOSIT',
        // GAP-28 (defense-in-depth): ключ от external_id провайдера, а не только от
        // нашей платёжки — повторный коллбэк по тому же внешнему платежу не зачислит дважды,
        // даже если смэпился на другую платёжку.
        idempotencyKey: 'deposit_rukassa_' + externalId,
        description: 'Пополнение через Rukassa',
        metadata: { provider: 'rukassa', external_id: externalId },
      })
      await this.users.onDepositCompleted(pr.userId, currency, pr.method || 'card')
      await this.repo.updateStatus(pr.id, 'completed', {
        completedAt: new Date(),
        externalStatus: status,
      })
    } else if (outcome === 'failure') {
      await this.repo.updateStatus(pr.id, 'failed', { externalStatus: status })
    } else {
      await this.repo.updateStatus(pr.id, 'processing', { externalStatus: status })
    }
  }
}
