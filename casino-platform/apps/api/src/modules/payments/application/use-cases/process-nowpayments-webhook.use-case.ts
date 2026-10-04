import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { KycFacade } from '@modules/kyc/facade/kyc.facade'
import { UsersFacade } from '@modules/users/facade/users.facade'
import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import type { Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import {
  type INowPaymentsClient,
  type IPaymentRequestRepository,
  NOWPAYMENTS_CLIENT,
  PAYMENT_REQUEST_REPOSITORY,
} from '../../domain/payments.ports'

/** IPN-запрос провайдера: заголовки, разобранный JSON, оригинальные байты тела и IP. */
export interface ProcessNowPaymentsWebhookInput {
  rawHeaders: Record<string, string>
  body: Record<string, unknown>
  rawBody: string
  ip: string
}

@Injectable()
export class ProcessNOWPaymentsWebhookUseCase {
  private logger = new Logger(ProcessNOWPaymentsWebhookUseCase.name)

  constructor(
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
    @Inject(NOWPAYMENTS_CLIENT) private readonly np: INowPaymentsClient,
    @Inject(WalletFacade) private wallet: WalletFacade,
    @Inject(UsersFacade) private users: UsersFacade,
    // KycFacade, а не репозиторий kyc: межмодульный доступ только через фасад
    // (AGENTS.md правило 4). Нужен для эскалации после зачисления — см. creditCryptoDeposit.
    @Inject(KycFacade) private kyc: KycFacade,
  ) {}
  async execute(input: ProcessNowPaymentsWebhookInput): Promise<{ ok: boolean }> {
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
    pr: {
      id: string
      userId: string
      status: string
      currency: string
      amount: { toString(): string }
      amountRub: { toString(): string } | null
      metadata: unknown
    },
    paymentStatus: string,
    body: Record<string, unknown>,
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
    pr: {
      id: string
      userId: string
      currency: string
      amount: { toString(): string }
      amountRub: { toString(): string } | null
      metadata: unknown
    },
    body: Record<string, unknown>,
  ): Promise<void> {
    const actuallyPaid =
      String(body.actually_paid ?? '') || String(body.pay_amount ?? '') || pr.amount.toString()
    await this.wallet.credit({
      userId: pr.userId,
      currency: pr.currency as Currency,
      amount: String(actuallyPaid),
      type: 'DEPOSIT',
      // GAP-28 (defense-in-depth): ключ от external_id провайдера — повторная доставка
      // IPN по тому же payment_id не зачислит дважды.
      idempotencyKey: 'deposit_nowpayments_' + String(body.payment_id ?? ''),
      description: 'Крипто-пополнение через NOWPayments',
      metadata: {
        provider: 'nowpayments',
        external_id: String(body.payment_id ?? ''),
        actually_paid: actuallyPaid,
      },
    })
    const cryptoMethod = pr.currency === 'BTC' ? 'btc' : 'usdt_trc20'
    await this.users.onDepositCompleted(pr.userId, pr.currency, cryptoMethod)
    const creditedRub = this.creditedAmountRub(pr, actuallyPaid)
    await this.repo.updateStatus(pr.id, 'completed', {
      completedAt: new Date(),
      externalStatus: String(body.payment_status ?? ''),
      ...(creditedRub !== undefined && { amountRub: creditedRub }),
    })
    // Эскалация, а не отказ: провайдер уже принял деньги, и NOWPayments платит
    // столько, сколько пришло фактически (actually_paid выше запрошенной суммы),
    // поэтому лимит без KYC здесь можно и превысить. Проверка — после
    // updateStatus: агрегат суммирует только completed-заявки, включая эту, и
    // видит уже пересчитанный amountRub (creditedAmountRub), а не оценку интента.
    // Дубликат-доставка сюда не попадает: early-return по pr.status === 'completed'
    // в execute, то есть эскалация не сработает второй раз для того же платежа.
    await this.kyc.escalateOverDepositLimit({ userId: pr.userId, paymentRequestId: pr.id })
  }

  /**
   * RUB, который реально зачёлся, если он отличается от оценки на интенте (GAP-72).
   *
   * Кошелёк получает `actuallyPaid` — фактический курс провайдера, а заявка до
   * этого хранила `amountRub`, посчитанный `getEstimatePrice` до оплаты. Если
   * игрок перевёл больше или меньше запрошенного, `amount_rub` отстаёт от
   * кошелька, и агрегат лимита без KYC (`kyc.prisma.ts:getTotalDepositedRub`)
   * считает не те деньги, которые попали на счёт.
   *
   * Пересчёт — отношением той же валюты: `actually_paid` и `pay_amount` из
   * метаданных заявки стоят в единицах `pr.currency`, поэтому отношением и
   * масштабируем оценку. `undefined` — когда пересчитать нельзя (нет оценки
   * или `pay_amount`, делитель ноль либо сумма не money-строка, факт равен
   * запросу): тогда оставляем amountRub как есть, хуже не станет.
   */
  private creditedAmountRub(
    pr: { amountRub: { toString(): string } | null; metadata: unknown },
    actuallyPaid: string,
  ): string | undefined {
    const base = pr.amountRub?.toString() ?? ''
    const requested = this.requestedPayAmount(pr.metadata)
    if (!canScaleRub(base, actuallyPaid, requested)) {
      return undefined
    }
    const ratio = money.divide(actuallyPaid, requested)
    return money.toDisplay(money.multiply(base, ratio), 'RUB')
  }

  /** Запрошенная сумма в крипто-единицах из метаданных заявки (`pay_amount`). */
  private requestedPayAmount(metadata: unknown): string {
    if (metadata === null || typeof metadata !== 'object') {
      return ''
    }
    const raw = (metadata as { pay_amount?: unknown }).pay_amount
    if (typeof raw === 'string' || typeof raw === 'number') {
      return String(raw)
    }
    if (raw !== null && typeof raw === 'object' && 'toString' in raw) {
      return String((raw as { toString(): string }).toString())
    }
    return ''
  }
}

/** Деньги в money-строке: цифры и необязательная десятичная точка. */
function isMoney(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value.trim())
}

/**
 * Можно ли пересчитывать оценку интента отношением `actually_paid / pay_amount`:
 * нужны три money-строки, положительный делитель и факт, отличающийся от запроса.
 *
 * Про делитель — отдельная проверка: `Decimal(200).div(0)` не бросает, а отдаёт
 * Infinity, `toDisplay` превращает его в строку `"Infinity"`, и она ушла бы в
 * колонку DECIMAL(20,2). Отрицательный `actually_paid` — выдумка провайдера,
 * а не деньги: сумму зачисления он уменьшить не может.
 */
function canScaleRub(base: string, actuallyPaid: string, requested: string): boolean {
  if (!isMoney(base) || !isMoney(actuallyPaid) || !isMoney(requested)) {
    return false
  }
  return (
    money.isPositive(requested) &&
    !money.isGreaterThan('0', actuallyPaid) &&
    !money.equals(actuallyPaid, requested)
  )
}
