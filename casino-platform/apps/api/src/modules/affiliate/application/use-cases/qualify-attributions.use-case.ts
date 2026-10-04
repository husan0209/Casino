/**
 * Квалификация атрибуций (UC-AFF-07, ТЗ ч.8 §7.4).
 *
 * Атрибуция создаётся `pending` и становится `qualified`, только когда игрок:
 *  1. сделал депозит;
 *  2. депозит не ниже порога (настройка affiliate_min_deposit);
 *  3. прошёл KYC (настройка affiliate_require_kyc).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ JOB, А НЕ ПРОВЕРКА В МОМЕНТ ДЕПОЗИТА. Игрок может сначала
 * внести депозит, а KYC пройти через несколько дней. Если бы квалификация была
 * только в момент депозита, такой игрок потерял бы атрибуцию навсегда. Hourly
 * job ловит эту гонку: как только выполнены все условия — атрибуция
 * квалифицируется, и с этого дня участвует в суточном расчёте.
 *
 * Идемпотентно: qualify вызывается только для `pending` и переводит в
 * `qualified`; повторный тик по уже квалифицированным ничего не делает.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import {
  AFFILIATE_ATTRIBUTION_REPOSITORY,
  AFFILIATE_PLAYER_PROVISIONING_REPOSITORY,
  type AffiliateAttributionRepository,
  type AffiliatePlayerProvisioningRepository,
} from '../../domain/repositories/affiliate.repository'
import { AffiliateSettingsService } from '../affiliate-settings.service'

/** Сколько атрибуций обрабатываем за один проход постранично. */
const QUALIFY_PAGE_SIZE = 200

export interface QualificationResult {
  checked: number
  qualified: number
  /** Остались pending: не хватает KYC или порог не достигнут. */
  stillPending: number
  errors: string[]
}

@Injectable()
export class QualifyAttributionsUseCase {
  private readonly logger = new Logger(QualifyAttributionsUseCase.name)

  constructor(
    @Inject(AFFILIATE_ATTRIBUTION_REPOSITORY)
    private readonly attributions: AffiliateAttributionRepository,
    @Inject(AFFILIATE_PLAYER_PROVISIONING_REPOSITORY)
    private readonly players: AffiliatePlayerProvisioningRepository,
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
  ) {}

  /**
   * Один проход по всем `pending`-атрибуциям.
   *
   * Депозиты берутся из `payment_requests` (первоисточник), а не из колонки
   * `total_deposit` атрибуции. Колонку заполняет только `applyDeposit`, а
   * вызывающего у него нет: событие «депозит завершён» живёт в payments, который
   * не может импортировать affiliate (цикл `payments → affiliate → admin →
   * payments`). Оставаться на накопленном значении означало бы, что при
   * любом ненулевом пороге и даже без него (`first_deposit_at` пустой всегда)
   * не квалифицируется никто — молча, без ошибки.
   *
   * Квалифицируя по первоисточнику, сюда же записываем накопленное:
   * `total_deposit`, `deposit_count`, `first_deposit_*` становятся реальными, и
   * админ видит их без пересчёта.
   */
  async execute(): Promise<QualificationResult> {
    const result: QualificationResult = {
      checked: 0,
      qualified: 0,
      stillPending: 0,
      errors: [],
    }
    const settings = await this.settings.get()
    const minDeposit = new Decimal(settings.minDepositRub)

    let page = 1
    for (;;) {
      const batch = await this.attributions.list({
        status: 'pending',
        page,
        perPage: QUALIFY_PAGE_SIZE,
      })
      if (batch.items.length === 0) {
        break
      }
      for (const attribution of batch.items) {
        await this.processOne(attribution.id, minDeposit, settings.requireKyc, result)
      }
      if (batch.items.length < QUALIFY_PAGE_SIZE) {
        break
      }
      page += 1
    }

    if (result.qualified > 0) {
      this.logger.log(
        `Affiliate qualification: checked=${result.checked} qualified=${result.qualified} pending=${result.stillPending}`,
      )
    }
    return result
  }

  /**
   * Одна атрибуция: квалифицировать или зафиксировать причину ожидания.
   * Ошибка не пробрасывается — один битый id не должен останавливать тик.
   */
  private async processOne(
    attributionId: string,
    minDeposit: Decimal,
    requireKyc: boolean,
    result: QualificationResult,
  ): Promise<void> {
    result.checked += 1
    try {
      const qualified = await this.tryQualify(attributionId, minDeposit, requireKyc)
      if (qualified) {
        result.qualified += 1
        return
      }
      result.stillPending += 1
    } catch (err) {
      this.logger.error(`Qualification failed for attribution ${attributionId}: ${String(err)}`)
      result.errors.push(`${attributionId}: ${String(err)}`)
    }
  }

  /** Проверяет условия для одной атрибуции. */
  private async tryQualify(
    attributionId: string,
    minDeposit: Decimal,
    requireKyc: boolean,
  ): Promise<boolean> {
    const attribution = await this.attributions.findById(attributionId)
    if (attribution?.status !== 'pending') {
      return false
    }
    const deposits = await this.attributions.sumPlayerDeposits(attribution.playerId)
    // Порог и факт депозита — отдельные условия: `min_deposit = 0` значит «без
    // порога», но не «квалифицируем игрока, который ничего не внёс».
    if (deposits.count === 0 || deposits.firstDepositAt === null) {
      return false
    }
    if (new Decimal(deposits.totalRub).lt(minDeposit)) {
      return false
    }
    if (requireKyc && !(await this.players.isKycApproved(attribution.playerId))) {
      return false
    }

    // Накопленное записываем из первоисточника: админ видит total_deposit /
    // deposit_count / first_deposit_* без пересчёта, и суточный расчёт
    // (listQualifiedForCalc фильтрует по first_deposit_at) подхватывает их.
    await this.attributions.qualify({
      id: attributionId,
      firstDepositId: deposits.firstDepositId,
      firstDepositAt: deposits.firstDepositAt,
      totalDeposit: deposits.totalRub,
      depositCount: deposits.count,
    })
    return true
  }
}
