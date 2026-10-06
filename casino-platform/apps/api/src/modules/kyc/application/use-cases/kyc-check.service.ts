import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'

import { money } from '@casino/shared-utils'

import { DepositLimitExceededError, KycRequiredError } from '../../domain/errors'
import { type IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'
import { kycDepositLimitRub } from '../deposit-limit'

@Injectable()
export class KycCheckService {
  private readonly logger = new Logger(KycCheckService.name)

  constructor(
    @Inject(KYC_REPOSITORY) private repo: IKycRepository,
    // Порог читается отсюда, а не литералом в коде: значения на сервере и в
    // GET /kyc (GetKycStatusUseCase) обязаны совпадать — см. application/deposit-limit.ts.
    @Inject(ConfigService) private config: ConfigService,
  ) {}

  async assertCanDeposit(
    userId: string,
    newDepositRub: string,
    limitRub?: string,
  ): Promise<void> {
    const status = await this.repo.getStatus(userId)
    if (status?.status === 'approved') {
      return
    }
    // limitRub — явное переопределение от callers; по умолчанию всегда конфиг.
    const limit = limitRub ?? this.depositLimitRub()
    const total = (await this.repo.getTotalDepositedRub(userId)) || '0'
    if (money.isGreaterThan(money.add(total, newDepositRub), limit)) {
      throw new DepositLimitExceededError(
        `Превышен лимит ${limit} RUB без KYC. Пройдите верификацию.`,
      )
    }
  }

  async assertCanWithdraw(userId: string): Promise<void> {
    const status = await this.repo.getStatus(userId)
    if (status?.status !== 'approved') {
      throw new KycRequiredError('Вывод средств требует KYC верификации')
    }
  }

  /**
   * Эскалация депозита, который ПРОСКОЧИЛ лимит (defect #2).
   *
   * Вызывается из webhook-обработников уже ПОСЛЕ успешного зачисления: игрок,
   * заплативший реальные деньги, не имеет права остаться без средств, поэтому
   * здесь нельзя отказывать — можно только фиксировать нарушение. Причины, по
   * которым депозит проходит мимо проверки на интенте: заявка создана до
   * правила/до понижения порога, гонка двух интентов (проверка по sum
   * «прошлое + новый», оба читают одно прошлое), провайдер заплатил больше
   * запрошенного (NOWPayments `actually_paid`).
   *
   * Сейчас = структурированный warn-лог (userId, id платёжки, порог и сумма
   * — строки). Смены статуса KYC-профиля или уведомления нет: KycStatus в
   * схеме не имеет состояния «требуется KYC», а notifications kyc-модуль не
   * импортирует (MODULE_BOUNDARIES §4.3) — это заведено отдельной задачей.
   *
   * Исключения наружу не отдаём: зачисление уже состоялось, и падение лога не
   * должно помечать вебхук ошибочным и провоцировать повторную доставку.
   */
  async escalateOverDepositLimit(args: {
    userId: string
    paymentRequestId: string
  }): Promise<void> {
    try {
      const status = await this.repo.getStatus(args.userId)
      if (status?.status === 'approved') {
        return
      }
      const limit = this.depositLimitRub()
      const total = (await this.repo.getTotalDepositedRub(args.userId)) || '0'
      if (!money.isGreaterThan(total, limit)) {
        return
      }
      this.logger.warn({
        msg: 'KYC deposit limit exceeded by credited deposit',
        event: 'kyc_deposit_limit_exceeded',
        user_id: args.userId,
        payment_request_id: args.paymentRequestId,
        threshold_rub: limit,
        total_deposited_rub: total,
      })
    } catch (e) {
      this.logger.error(
        `KYC deposit-limit escalation failed for user ${args.userId}: ${errorMessage(e)}`,
      )
    }
  }

  /** Порог без KYC в money-строке (общий с GET /kyc). */
  private depositLimitRub(): string {
    return kycDepositLimitRub(this.config)
  }
}
