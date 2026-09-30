/**
 * Диспетчер affiliate-задач maintenance-очереди (ТЗ ч.8 §15).
 *
 * Отдельный класс по образцу PaymentJobHandlers: список задач растёт, а
 * useFactory в MAINTENANCE_HANDLERS не должен превращаться в конструктор с
 * пятью аргументами.
 */
import { Inject, Injectable } from '@nestjs/common'

import { AffiliateClicksCleanupJob } from '../application/affiliate-clicks-cleanup.job'
import { AffiliateDailyJob } from '../application/affiliate-daily.job'
import { AffiliateQualificationJob } from '../application/affiliate-qualification.job'

import type { MaintenanceHandlers } from '../domain/maintenance.ports'

@Injectable()
export class AffiliateJobHandlers {
  constructor(
    @Inject(AffiliateDailyJob) private readonly daily: AffiliateDailyJob,
    @Inject(AffiliateQualificationJob) private readonly qualification: AffiliateQualificationJob,
    @Inject(AffiliateClicksCleanupJob) private readonly clicksCleanup: AffiliateClicksCleanupJob,
  ) {}

  get map(): Pick<
    MaintenanceHandlers,
    'affiliate-daily' | 'affiliate-qualification' | 'affiliate-clicks-cleanup'
  > {
    return {
      'affiliate-daily': () => this.daily.execute(),
      'affiliate-qualification': () => this.qualification.execute(),
      'affiliate-clicks-cleanup': () => this.clicksCleanup.execute(),
    }
  }
}
