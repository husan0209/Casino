/**
 * Job `affiliate-qualification` (ТЗ ч.8 §15): почасовая проверка квалификации.
 *
 * Ловит гонку «депозит прошёл раньше, чем KYC»: такие атрибуции оставались бы
 * pending навсегда, если бы квалификация проверялась только в момент депозита.
 *
 * Зависит от AffiliateFacade, а не от use case'а напрямую: наружу из
 * affiliate-модуля торчит только фасад (MODULE_TEMPLATE шаг 9).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import { AffiliateFacade } from '../../affiliate/facade/affiliate.facade'

import type { QualificationResult } from '../../affiliate/facade/affiliate.facade'

@Injectable()
export class AffiliateQualificationJob {
  private readonly logger = new Logger(AffiliateQualificationJob.name)

  constructor(@Inject(AffiliateFacade) private readonly affiliateFacade: AffiliateFacade) {}

  async execute(): Promise<QualificationResult> {
    const result = await this.affiliateFacade.qualifyAttributions()
    if (result.qualified > 0) {
      this.logger.log(
        `affiliate-qualification: qualified=${result.qualified} pending=${result.stillPending} errors=${result.errors.length}`,
      )
    }
    return result
  }
}
