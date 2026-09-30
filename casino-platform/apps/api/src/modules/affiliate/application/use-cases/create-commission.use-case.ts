/**
 * Расчёт NGR и создание начисления (UC-AFF-08, UC-AFF-09; ТЗ ч.8 §8).
 *
 * Это финансовое ядро программы. Ключевые инварианты:
 *
 *  1. ИДЕМПОТЕНТНОСТЬ. Начисление уникально по (affiliate, player, period,
 *     currency). Повторный запуск cron-а — типичная ситуация (ручной триггер
 *     после автоматического, рестарт воркера, два инстанса API) — не должен
 *     создавать дубль. Проверка идёт ДО расчёта, а уникальный индекс в БД
 *     служит последним рубежом на случай гонки.
 *
 *  2. СНИМОК СТАВКИ. revshare_rate копируется в начисление. Изменение ставки
 *     в админке не пересчитывает закрытые периоды — иначе пришлось бы отзывать
 *     уже зачисленные средства.
 *
 *  3. ДЕНЬГИ — СТРОКА. Ни одного number/float в арифметике (правило §1).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import {
  AFFILIATE_COMMISSION_REPOSITORY,
  AFFILIATE_GAME_ACTIVITY_REPOSITORY,
  AFFILIATE_REPOSITORY,
  type AffiliateCommissionRepository,
  type AffiliateRepository,
  type GameActivityRepository,
} from '../../domain/repositories/affiliate.repository'
import {
  calculateCommission,
  calculateNgr,
  type NgrResult,
} from '../../domain/value-objects/ngr-calculator'

export interface CreateCommissionInput {
  affiliateId: string
  playerId: string
  attributionId?: string | null
  periodStart: Date
  periodEnd: Date
}

/** Результат по одной (partner, player, currency) комбинации. */
export type CommissionOutcome =
  /** Уже было рассчитано ранее — идемпотентный повтор. */
  | { status: 'skipped_duplicate' }
  /** NGR <= 0 и перенос выключен — начисления нет, период зафиксирован. */
  | { status: 'skipped_negative_ngr'; ngr: string }
  /** Начисление создано, ждёт кредита (UC-AFF-10). */
  | { status: 'created'; commissionId: string; ngr: NgrResult; commissionAmount: string }

@Injectable()
export class CreateCommissionUseCase {
  private readonly logger = new Logger(CreateCommissionUseCase.name)

  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AFFILIATE_COMMISSION_REPOSITORY)
    private readonly commissions: AffiliateCommissionRepository,
    @Inject(AFFILIATE_GAME_ACTIVITY_REPOSITORY)
    private readonly activity: GameActivityRepository,
  ) {}

  /**
   * Создаёт начисление за ОДНУ валюту. Суммы в разных валютах не смешиваются
   * (ТЗ ч.8 §15): курсовой конвертации NGR не существует, поэтому партнёр
   * получает комиссию в той валюте, в которой играл игрок.
   */
  async executeForCurrency(
    input: CreateCommissionInput,
    currency: string,
  ): Promise<CommissionOutcome> {
    const { affiliateId, playerId, periodStart, periodEnd } = input

    // Шаг 1 — идемпотентность. Проверка ДО любой арифметики: если начисление
    // уже есть, не тратим CPU на пересчёт и не пишем в БД.
    const existing = await this.commissions.findByPeriod({
      affiliateId,
      playerId,
      periodStart,
      currency,
    })
    if (existing !== null) {
      return { status: 'skipped_duplicate' }
    }

    const affiliate = await this.affiliates.findById(affiliateId)
    if (affiliate === null) {
      this.logger.warn(`Affiliate ${affiliateId} not found while creating commission`)
      return { status: 'skipped_duplicate' }
    }

    // Шаг 2 — сбор сырых сумм за период по нужной валюте.
    const collected = await this.collectActivity(input, currency)
    if (collected === null) {
      return { status: 'skipped_duplicate' }
    }

    // Шаг 3 — расчёт. provider_fee_sum = 0 в MVP (см. PROVIDER_FEE_NOTE).
    const ngr = calculateNgr({ ...collected, providerFeeSum: '0' })

    if (!ngr.isPositive) {
      // Отрицательный или нулевой NGR. При выключенном переносе начисление
      // НЕ создаётся вовсе: иначе таблица забьётся нулевыми строками, а
      // партнёр увидит «периоды с нулём» без объяснения почему.
      this.logger.debug(
        `No commission: affiliate=${affiliateId} player=${playerId} ccy=${currency} ngr=${ngr.ngr}`,
      )
      return { status: 'skipped_negative_ngr', ngr: ngr.ngr }
    }

    // Шаг 4 — снимок ставки. Ставка партнёра может измениться между шагом 1
    // и записью (конкурирующий админский запрос), поэтому перечитываем её
    // непосредственно перед записью: начисление получит актуальный снимок.
    const rateSnapshot =
      (await this.affiliates.findById(affiliateId))?.revshareRate ?? affiliate.revshareRate
    const commissionAmount = calculateCommission(ngr.ngr, rateSnapshot)
    if (isZero(commissionAmount)) {
      return { status: 'skipped_negative_ngr', ngr: ngr.ngr }
    }

    // Шаг 5 — запись. Точка идемпотентности: уникальный индекс
    // (affiliate, player, period, currency) отсекает гонку двух cron-тиков.
    const commission = await this.commissions.create({
      affiliateId,
      playerId,
      attributionId: input.attributionId ?? null,
      periodStart,
      periodEnd,
      currency,
      betSum: ngr.ngrBreakdown.betSum,
      winSum: ngr.ngrBreakdown.winSum,
      rollbackSum: ngr.ngrBreakdown.rollbackSum,
      bonusSum: ngr.ngrBreakdown.bonusSum,
      providerFeeSum: ngr.ngrBreakdown.providerFeeSum,
      ggrAmount: ngr.ggr,
      ngrAmount: ngr.ngr,
      revshareRate: rateSnapshot,
      commissionAmount,
    })

    return {
      status: 'created',
      commissionId: commission.id,
      ngr,
      commissionAmount: commission.commissionAmount,
    }
  }

  /**
   * Сырые суммы игрока за период по одной валюте.
   *
   * Возвращает null, если у игрока не было игровой активности: NGR в этом
   * случае заведомо нулевой, начисление не создастся, и лишний запрос на
   * бонусы не нужен.
   */
  private async collectActivity(
    input: CreateCommissionInput,
    currency: string,
  ): Promise<{
    betSum: string
    winSum: string
    rollbackSum: string
    bonusSum: string
  } | null> {
    const range = { from: input.periodStart, to: input.periodEnd }
    const totals = await this.activity.sumGameActivity({
      playerId: input.playerId,
      ...range,
    })
    const betSum = totals.bets.get(currency) ?? '0'
    const winSum = totals.wins.get(currency) ?? '0'
    const rollbackSum = totals.rollbacks.get(currency) ?? '0'
    if (isZero(betSum) && isZero(winSum) && isZero(rollbackSum)) {
      return null
    }
    const bonuses = await this.activity.sumPlayerBonuses({ playerId: input.playerId, ...range })
    return { betSum, winSum, rollbackSum, bonusSum: bonuses.get(currency) ?? '0' }
  }
}

/** Список валют, в которых игрок имел игровую активность за период. */
export async function collectCurrencies(
  activity: GameActivityRepository,
  args: { playerId: string; from: Date; to: Date },
): Promise<string[]> {
  const totals = await activity.sumGameActivity(args)
  const currencies = new Set<string>()
  for (const currency of totals.bets.keys()) {
    currencies.add(currency)
  }
  for (const currency of totals.wins.keys()) {
    currencies.add(currency)
  }
  for (const currency of totals.rollbacks.keys()) {
    currencies.add(currency)
  }
  return [...currencies]
}

function isZero(value: string): boolean {
  try {
    return new Decimal(value).isZero()
  } catch {
    return true
  }
}
