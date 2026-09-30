/**
 * Фасад партнёрской программы — единственная точка входа для других модулей
 * (MODULE_TEMPLATE шаг 8, AI_DEVELOPMENT_RULES §4).
 *
 * Наружу наружу торчат только операции, которые действительно кому-то нужны:
 * auth-вызывает attributePlayer при регистрации, maintenance — запускает
 * суточный расчёт. Внутренние use cases наружу не выставляются.
 */
export type { QualificationResult } from '../application/use-cases/qualify-attributions.use-case'
import { Inject, Injectable } from '@nestjs/common'

import { AffiliateClicksCleanupService } from '../application/affiliate-clicks-cleanup.service'
import {
  AffiliateDailyRunUseCase,
  type AffiliateDailyRunResult,
} from '../application/use-cases/affiliate-daily-run.use-case'
import {
  AttributePlayerUseCase,
  type AttributePlayerInput,
  type AttributePlayerResult,
} from '../application/use-cases/attribute-player.use-case'
import {
  ClawbackPlayerCommissionsUseCase,
  type ClawbackResult,
} from '../application/use-cases/clawback-player-commissions.use-case'
import {
  QualifyAttributionsUseCase,
  type QualificationResult,
} from '../application/use-cases/qualify-attributions.use-case'

@Injectable()
export class AffiliateFacade {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(AttributePlayerUseCase) private readonly attributePlayerUseCase: AttributePlayerUseCase,
    @Inject(AffiliateDailyRunUseCase) private readonly dailyRunUseCase: AffiliateDailyRunUseCase,
    @Inject(ClawbackPlayerCommissionsUseCase)
    private readonly clawbackUseCase: ClawbackPlayerCommissionsUseCase,
    @Inject(QualifyAttributionsUseCase) private readonly qualifyUseCase: QualifyAttributionsUseCase,
    @Inject(AffiliateClicksCleanupService)
    private readonly clicksCleanup: AffiliateClicksCleanupService,
  ) {}

  /**
   * Привязка игрока к партнёру при регистрации. Вызывается из auth-модуля.
   *
   * Никогда не пробрасывает ошибку: регистрация игрока важнее партнёрской
   * аналитики. Внутри use case'а ошибки уже перехватываются — этот контракт
   * зафиксирован для будущих вызывающих.
   */
  attributePlayer(input: AttributePlayerInput): Promise<AttributePlayerResult> {
    return this.attributePlayerUseCase.execute(input)
  }

  /** Суточный расчёт RevShare (cron + ручной триггер из maintenance). */
  runDaily(dateStr?: string): Promise<AffiliateDailyRunResult> {
    return this.dailyRunUseCase.execute(dateStr)
  }

  /** Clawback начислений самоисключённого игрока (ответственная игра). */
  clawbackPlayer(playerId: string): Promise<ClawbackResult> {
    return this.clawbackUseCase.execute({ playerId })
  }

  /**
   * Квалификация атрибуций (job `affiliate-qualification`).
   *
   * Именно фасад, а не прямой экспорт use case'а: так инвариант «наружу только
   * фасад» сохраняется, иначе DI-граф разъезжается по мере роста модуля.
   */
  qualifyAttributions(): Promise<QualificationResult> {
    return this.qualifyUseCase.execute()
  }

  /** Retention кликов (job `affiliate-clicks-cleanup`). */
  cleanupClicks(): Promise<{ deleted: number; retentionDays: number }> {
    return this.clicksCleanup.execute()
  }
}
