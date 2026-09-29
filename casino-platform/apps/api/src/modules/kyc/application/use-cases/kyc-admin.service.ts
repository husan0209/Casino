import { Inject, Injectable } from '@nestjs/common'

import {
  type IKycRepository,
  KYC_REPOSITORY,
  type KycProfileRow,
} from '../../domain/repositories/kyc.repository'

/** Admin-операции KYC (список/карточка/решение) — application-слой вместо
 *  прямого репозитория в контроллере (В3). */
@Injectable()
export class KycAdminService {
  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}

  list(
    status?: string,
    page = 1,
    perPage = 20,
  ): Promise<{ items: KycProfileRow[]; total: number }> {
    return this.repo.listAdmin(status, page, perPage)
  }

  async getWithTotalDeposited(
    id: string,
  ): Promise<{ profile: KycProfileRow; totalDepositedRub: string } | null> {
    const profile = await this.repo.getById(id)
    if (!profile) {
      return null
    }
    // enrich with total deposited for admin view
    const totalDepositedRub = await this.repo.getTotalDepositedRub(profile.userId).catch(() => '0')
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
