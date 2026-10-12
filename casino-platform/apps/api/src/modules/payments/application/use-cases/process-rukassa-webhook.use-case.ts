import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { KycFacade } from '@modules/kyc/facade/kyc.facade'
import { UsersFacade } from '@modules/users/facade/users.facade'
import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import type { Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { classifyPaymentStatus } from '../../domain/payment-status'
import {
  type IRukassaClient,
  type IPaymentRequestRepository,
  type PaymentRequest,
  PAYMENT_REQUEST_REPOSITORY,
  RUKASSA_CLIENT,
} from '../../domain/payments.ports'

/** Ответ провайдеру по их контракту: 'OK' принимает, иначе — до 5 повторных доставок. */
export type RukassaWebhookReply = 'OK' | 'ERROR AMOUNT' | 'FAIL'

/** Уведомление Rukassa: id, order_id, amount, in_amount, data, createdDateTime, status. */
export interface ProcessRukassaWebhookInput {
  rawHeaders: Record<string, string>
  body: Record<string, unknown>
  rawBody: string
  ip: string
}

/**
 * `data` — тот самый JSON, который мы передали при создании платежа. Их пример
 * просит html_entity_decode перед парсингом, поэтому сначала разбор как есть,
 * потом с развёрнутыми сущностями.
 */
function readPaymentRequestId(data: unknown): string | null {
  if (typeof data !== 'string' || !data) {
    return null
  }
  const candidates = [data, decodeEntities(data)]
  for (const candidate of candidates) {
    const parsed = parseJsonObject(candidate)
    const id = parsed?.payment_request_id
    if (typeof id === 'string' && id) {
      return id
    }
  }
  return null
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Числовое поле уведомления в строку (деньги не через number). */
function asAmount(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

@Injectable()
export class ProcessRukassaWebhookUseCase {
  private logger = new Logger(ProcessRukassaWebhookUseCase.name)

  constructor(
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
    @Inject(RUKASSA_CLIENT) private readonly rukassa: IRukassaClient,
    @Inject(WalletFacade) private wallet: WalletFacade,
    @Inject(UsersFacade) private users: UsersFacade,
    // KycFacade, а не репозиторий kyc: межмодульный доступ только через фасад
    // (AGENTS.md правило 4). Нужен для эскалации после зачисления — см. applyOutcome.
    @Inject(KycFacade) private kyc: KycFacade,
  ) {}

  async execute(input: ProcessRukassaWebhookInput): Promise<RukassaWebhookReply> {
    const { rawHeaders, body, rawBody, ip } = input
    // Store the EXACT raw body bytes the provider signed. If we ever need to
    // re-verify or investigate a dispute, we have the original payload.
    const cb = await this.repo.saveCallback({
      provider: 'rukassa',
      externalId: asAmount(body.id),
      rawHeaders,
      rawBody,
      ipAddress: ip,
    })
    try {
      if (!this.rukassa.verifyCallback(rawHeaders, body)) {
        await this.repo.markCallbackProcessed(cb.id, 'invalid_signature')
        this.logger.warn('Rukassa invalid signature')
        return 'FAIL'
      }
      const pr = await this.resolvePaymentRequest(body)
      if (!pr) {
        await this.repo.markCallbackProcessed(cb.id, 'payment_request_not_found')
        this.logger.warn(
          `Rukassa notification for unknown payment: id=${asAmount(body.id)} order=${asAmount(body.order_id)}`,
        )
        return 'OK'
      }
      if (pr.status === 'completed') {
        await this.repo.markCallbackProcessed(cb.id, 'duplicate')
        return 'OK'
      }
      const outcome = await this.applyOutcome(pr, body)
      await this.repo.markCallbackProcessed(cb.id, outcome)
      return outcome === 'ok' ? 'OK' : 'ERROR AMOUNT'
    } catch (e) {
      // Не принимаем доставку, которую не смогли обработать: у провайдера есть
      // 5 повторов, зачисление идемпотентно по external_id — деньги не задвоятся.
      this.logger.error('Rukassa webhook err ' + errorMessage(e))
      await this.repo.markCallbackProcessed(cb.id, 'error: ' + errorMessage(e))
      return 'FAIL'
    }
  }

  /**
   * Платёжка. Приоритет — их `id` операции: он единственный входит в подпись
   * уведомления. `data` (наш payment_request_id) провайдер НЕ подписывает, поэтому
   * она принимается только как подтверждение той же заявки: либо external_id уже
   * совпал с подписанным id, либо external_id ещё не записан (упал updateStatus
   * после create) и сумма заявки совпадает с подписанной суммой. Иначе перехваченное
   * уведомление можно было бы переадресовать на чужую заявку.
   */
  private async resolvePaymentRequest(
    body: Record<string, unknown>,
  ): Promise<PaymentRequest | null> {
    const theirId = asAmount(body.id)
    if (theirId !== '') {
      const byExternal = await this.repo.findByExternalId(theirId, 'rukassa')
      if (byExternal) {
        return byExternal
      }
    }
    return this.resolveFromData(body, theirId)
  }

  /**
   * Резолв по неподписанному `data`. Разрешаем его, только когда заявка
   * подтверждена подписанным `id`: external_id уже совпал с ним (или ещё не
   * записан, и тогда совпадает сумма заявки с подписанной `amount`).
   */
  private async resolveFromData(
    body: Record<string, unknown>,
    theirId: string,
  ): Promise<PaymentRequest | null> {
    const fromData = readPaymentRequestId(body.data)
    if (!fromData || theirId === '') {
      return null
    }
    const byData = await this.repo.findById(fromData)
    if (!byData) {
      return null
    }
    if (byData.provider !== 'rukassa' || byData.type !== 'deposit') {
      return null
    }
    if (byData.externalId) {
      return byData.externalId === theirId ? byData : null
    }
    const signed = asAmount(body.amount)
    return signed !== '' && money.equals(byData.amount.toString(), signed) ? byData : null
  }

  /** Успех -> зачисление депозита; failure -> failed; остальное -> processing. */
  private async applyOutcome(pr: PaymentRequest, body: Record<string, unknown>): Promise<string> {
    const status = String(body.status ?? '')
    const outcome = classifyPaymentStatus(status)
    if (outcome === 'success') {
      return this.creditDeposit(pr, body, status)
    }
    await this.repo.updateStatus(pr.id, outcome === 'failure' ? 'failed' : 'processing', {
      externalStatus: status,
    })
    return 'ok'
  }

  /**
   * Суммы должны сойтись с трёх сторон: заявка (`pr.amount`), подписанная `amount`
   * и фактически оплаченное `in_amount` (не меньше). Все сравнения — money.*,
   * числа провайдера приходят строками из form-полей.
   */
  private amountsMatch(pr: PaymentRequest, signed: string, paid: string): boolean {
    return (
      signed !== '' &&
      paid !== '' &&
      money.equals(pr.amount.toString(), signed) &&
      money.isGreaterOrEqual(paid, signed)
    )
  }

  /**
   * PAID. Два условия суммы, оба обязательны:
   * 1) заявленная нами сумма (`pr.amount`) равна подписанной `amount` — иначе
   *    зачисление идёт по цифре, которую платёж не подтверждал;
   * 2) `in_amount >= amount` — их собственная проверка из примера интеграции.
   * Недоплат/расхождение: зачисления нет, заявка остаётся pending (её снимает
   * expire-deposits), raw-тело лежит в payment_callbacks, провайдер получает
   * 'ERROR AMOUNT'.
   */
  private async creditDeposit(
    pr: PaymentRequest,
    body: Record<string, unknown>,
    status: string,
  ): Promise<string> {
    const signed = asAmount(body.amount)
    const paid = asAmount(body.in_amount) || signed
    if (!this.amountsMatch(pr, signed, paid)) {
      const order = asAmount(body.order_id)
      const expected = pr.amount.toString()
      this.logger.warn(
        `Rukassa amount mismatch: order=${order} pr=${expected} signed=${signed} paid=${paid}`,
      )
      return 'amount_mismatch'
    }
    const theirId = asAmount(body.id) || asAmount(body.order_id)
    await this.wallet.credit({
      userId: pr.userId,
      currency: (pr.currency || 'RUB') as Currency,
      amount: pr.amount.toString(),
      type: 'DEPOSIT',
      // GAP-28 (defense-in-depth): ключ от external_id провайдера, а не только от
      // нашей платёжки — повторный коллбэк по тому же внешнему платежу не зачислит дважды.
      idempotencyKey: 'deposit_rukassa_' + theirId,
      description: 'Пополнение через Rukassa',
      metadata: { provider: 'rukassa', external_id: theirId },
    })
    await this.users.onDepositCompleted(pr.userId, pr.currency || 'RUB', pr.method || 'card')
    await this.repo.updateStatus(pr.id, 'completed', {
      completedAt: new Date(),
      externalStatus: status,
      externalId: asAmount(body.id) || undefined,
    })
    // Эскалация, а не отказ: платёж уже принят провайдером и зачислен, «отменить»
    // его нельзя (AI_DEVELOPMENT_RULES §8). Порядок после updateStatus: агрегат
    // суммирует только completed-заявки, поэтому текущий депозит в него попадает.
    await this.kyc.escalateOverDepositLimit({ userId: pr.userId, paymentRequestId: pr.id })
    return 'ok'
  }
}
