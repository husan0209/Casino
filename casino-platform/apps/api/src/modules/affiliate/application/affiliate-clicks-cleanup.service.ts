/**
 * Очистка кликов партнёрской программы (ТЗ ч.8 §15).
 *
 * Отдельный application-класс вместо вызова репозитория напрямую из job'а:
 * так cleanup тестируется in-memory, как остальные maintenance-задачи
 * (maintenance.ports.ts, критерий 2/3 GAP-33).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import { AffiliateSettingsService } from './affiliate-settings.service'
import {
  AFFILIATE_CLICK_REPOSITORY,
  type AffiliateClickRepository,
} from '../domain/repositories/affiliate.repository'

@Injectable()
export class AffiliateClicksCleanupService {
  private readonly logger = new Logger(AffiliateClicksCleanupService.name)

  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(AFFILIATE_CLICK_REPOSITORY) private readonly clicks: AffiliateClickRepository,
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
  ) {}

  /**
   * Retention по настройке программы (job-у не нужно знать про system_settings).
   *
   * Идемпотентно: `deleteMany` по дате — повторный вызов безопасен. Атрибуции
   * переживают удаление клика (ON DELETE SET NULL на click_id), поэтому
   * начисления и история игрока не теряются.
   */
  async execute(): Promise<{ deleted: number; retentionDays: number }> {
    const settings = await this.settings.get()
    const cutoff = new Date(Date.now() - settings.clickRetentionDays * 24 * 60 * 60 * 1000)
    const deleted = await this.deleteOlderThan(cutoff)
    return { deleted, retentionDays: settings.clickRetentionDays }
  }

  /** Удаляет клики старше cutoff. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.clicks.cleanupOlderThan(cutoff)
    if (deleted > 0) {
      this.logger.log(
        `Deleted ${deleted} affiliate clicks older than ${cutoff.toISOString().slice(0, 10)}`,
      )
    }
    return deleted
  }
}
