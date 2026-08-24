import { Injectable } from '@nestjs/common'
import { UpdateAfterDepositUseCase } from '../application/use-cases/update-after-deposit.use-case'
import { UpdateCurrencyPreferenceUseCase } from '../application/use-cases/update-currency-preference.use-case'
import { GetGeoContextUseCase } from '../application/use-cases/get-geo-context.use-case'

@Injectable()
export class UsersFacade {
  constructor(
    private getGeoContextUseCase: GetGeoContextUseCase,
    private updateCurrency: UpdateCurrencyPreferenceUseCase,
    private updateAfterDeposit: UpdateAfterDepositUseCase,
  ) {}

  getGeoContext(userId: string) {
    return this.getGeoContextUseCase.execute(userId)
  }

  updateCurrencyPreference(userId: string, currency: string) {
    return this.updateCurrency.execute(userId, currency)
  }

  onDepositCompleted(userId: string, currency: string, method: string) {
    return this.updateAfterDeposit.execute(userId, currency, method)
  }
}
