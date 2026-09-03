import { Injectable } from '@nestjs/common'

import type { UserGeoContext } from '../domain/repositories/user-profile.repository'

import { GetGeoContextUseCase } from '../application/use-cases/get-geo-context.use-case'
import { UpdateAfterDepositUseCase } from '../application/use-cases/update-after-deposit.use-case'
import { UpdateCurrencyPreferenceUseCase } from '../application/use-cases/update-currency-preference.use-case'

@Injectable()
export class UsersFacade {
  constructor(
    private getGeoContextUseCase: GetGeoContextUseCase,
    private updateCurrency: UpdateCurrencyPreferenceUseCase,
    private updateAfterDeposit: UpdateAfterDepositUseCase,
  ) {}

  getGeoContext(userId: string): Promise<UserGeoContext | null> {
    return this.getGeoContextUseCase.execute(userId)
  }

  updateCurrencyPreference(userId: string, currency: string): Promise<void> {
    return this.updateCurrency.execute(userId, currency)
  }

  onDepositCompleted(userId: string, currency: string, method: string): Promise<void> {
    return this.updateAfterDeposit.execute(userId, currency, method)
  }
}
