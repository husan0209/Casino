import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { KycDepositTotalUnavailableError } from '../../domain/errors'
import {
  type IKycRepository,
  KYC_REPOSITORY,
  type KycProfileRow,
} from '../../domain/repositories/kyc.repository'

/** Admin-операции KYC (список/карточка/решение) — application-слой вместо
 *  прямого репозитория в контроллере (В3). */
@Injectable()
export class KycAdminService {
  private readonly logger = new Logger(KycAdminService.name)

  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}

  list(
    status?: string,
    page = 1,
    perPage = 20,
  ): Promise<{ items: KycProfileRow[]; total: number }> {
    return this.repo.listAdmin(status, page, perPage)
  }

  /**
   * Карточка модератора: профиль + сумма депозитов игрока.
   *
   * Fail-closed: отказ чтения депозитов идёт вверх как доменный
   * `KycDepositTotalUnavailableError` (503), а не превращается в «ноль
   * депозитов» — по выдуманным данным модератор одобрил бы выпуск средств.
   */
  async getWithTotalDeposited(
    id: string,
  ): Promise<{ profile: KycProfileRow; totalDepositedRub: string } | null> {
    const profile = await this.repo.getById(id)
    if (!profile) {
      return null
    }
    let totalDepositedRub: string
    try {
      totalDepositedRub = await this.repo.getTotalDepositedRub(profile.userId)
    } catch (error) {
      this.logger.error(
        `KYC-карточка ${id}: сумма депозитов игрока ${profile.userId} не получена (${errorMessage(
          error,
        )}) — решение модератора блокируется (fail-closed)`,
      )
      throw new KycDepositTotalUnavailableError()
    }
    return { profile, totalDepositedRub }
  }

  decide(args: {
    id: string
    status: 'approved' | 'rejected' | 'requires_resubmission'
    reason?: string
    reviewedBy: string
  }): Promise<void> {
    return this.repo.setStatus(args)
  }
}
