/**
 * Job `affiliate-clicks-cleanup` (ТЗ ч.8 §15): retention кликов.
 *
 * affiliate_clicks — самая растущая таблица программы (запись на КАЖДЫЙ клик,
 * включая ботов). Без cleanup она съедает диск, поэтому клики старше retention
 * (настройка `affiliate_click_retention_days`) удаляются.
 *
 * Что теряется. Антифрод-правило F1 (совпадение хеша IP последнего клика
 * партнёра с IP регистрации) работает только пока свежий клик есть. Поэтому
 * retention не должен быть меньше cookie-окна атрибуции — иначе при регистрации
 * не окажется сигнала для сравнения. Проверяется тестами и настройкой сида.
 *
 * Зависит от AffiliateFacade, а не от use case'а напрямую: наружу из
 * affiliate-модуля торчит только фасад (MODULE_TEMPLATE шаг 9).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import { AffiliateFacade } from '../../affiliate/facade/affiliate.facade'

@Injectable()
export class AffiliateClicksCleanupJob {
  private readonly logger = new Logger(AffiliateClicksCleanupJob.name)

  constructor(@Inject(AffiliateFacade) private readonly affiliateFacade: AffiliateFacade) {}

  async execute(): Promise<{ deleted: number; retentionDays: number }> {
    const result = await this.affiliateFacade.cleanupClicks()
    this.logger.log(
      `affiliate-clicks-cleanup: deleted=${result.deleted} retention=${result.retentionDays}d`,
    )
    return result
  }
}
