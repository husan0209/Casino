import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { GeoFacade } from '@modules/geo/facade/geo.facade'

import type { DisplayCurrency } from '@casino/shared-config'
import { money } from '@casino/shared-utils'

import { IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'

@Injectable()
export class GetKycStatusUseCase {
  constructor(
    @Inject(KYC_REPOSITORY) private repo: IKycRepository,
    private geo: GeoFacade,
    private config: ConfigService,
  ) {}

  async execute(userId: string, currency = 'RUB') {
    const status = await this.repo.getStatus(userId)
    const limitRub = this.config.get('KYC_DEPOSIT_LIMIT_RUB') || '5000'
    const totalRub = (await this.repo.getTotalDepositedRub(userId)) || '0'
    const remainingRub = money.isGreaterThan(totalRub, limitRub)
      ? '0'
      : money.subtract(limitRub, totalRub)

    const displayCurrency = (currency || 'RUB') as DisplayCurrency
    const limitRemaining = await this.geo.convertRubToDisplay(remainingRub, displayCurrency)

    return {
      ...status,
      deposit_limit_rub: limitRub,
      total_deposited_rub: totalRub,
      limit_remaining: limitRemaining,
      limit_currency: displayCurrency,
    }
  }
}
