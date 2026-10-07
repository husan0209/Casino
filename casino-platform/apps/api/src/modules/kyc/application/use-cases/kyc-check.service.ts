import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'

import { GeoFacade } from '@modules/geo/facade/geo.facade'

import { money } from '@casino/shared-utils'

import { KycRequiredError } from '../../domain/errors'
import { type IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'
import { kycDepositLimitRub, kycWithdrawLimitRub } from '../kyc-limits'
import { withdrawnRubTotal } from '../withdrawn-total'

@Injectable()
export class KycCheckService {
  private readonly logger = new Logger(KycCheckService.name)

  constructor(
    @Inject(KYC_REPOSITORY) private repo: IKycRepository,
    // Пороги читаются отсюда, а не литералом в коде: значения на сервере и в
    // GET /kyc (GetKycStatusUseCase) обязаны совпадать — см. application/kyc-limits.ts.
    @Inject(ConfigService) private config: ConfigService,
    // RUB-эквивалент заявок, у которых не записан amount_rub. kyc → geo уже
    // разрешён границами (GeoFacade используют и GetKycStatusUseCase, и
    // процесс расчёта лимита), нового ребра модулей эта правка не создаёт.
    @Inject(GeoFacade) private geo: GeoFacade,
  ) {}

  /**
   * Вывод без верификации — до `KYC_WITHDRAW_LIMIT_RUB` **суммарно** (решение
   * владельца 2026-10-07): «можно выводить до 5 000 ₽, захотел 5 000 ₽ 1 ₽ —
   * нужен KYC». Считаем по обороту, а не по одной заявке, иначе порог обходится
   * десятью заявками по 5 000 ₽ — ровно тем приёмом, от которого такой порог и
   * защищает. Одобрённому игроку порога нет: limit — это потолок анонимного
   * вывода, а не потолка вывода вообще (`withdrawMax` валюты проверяет payments).
   *
   * Заявка при этом остаётся ручной: оператор подтверждает её в админке и до, и
   * после порога (порог решает вопрос «нужен ли паспорт», а не «платим ли сами»).
   *
   * Fail-closed: падение хранилища KYC или истории выводов означает отказ, а не
   * «пропустили» — это единственный guard вывода.
   */
  async assertCanWithdraw(userId: string, amountRub: string): Promise<void> {
    const status = await this.repo.getStatus(userId)
    if (status?.status === 'approved') {
      return
    }
    const limit = kycWithdrawLimitRub(this.config)
    const alreadyRub = withdrawnRubTotal(
      await this.repo.listCountedWithdrawals(userId),
      (amount, currency) => this.geo.toRubEquivalent(amount, currency),
    )
    if (money.isGreaterThan(money.add(alreadyRub, amountRub), limit)) {
      throw new KycRequiredError(`Вывод свыше ${limit} ₽ без верификации невозможен — пройдите KYC`)
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
