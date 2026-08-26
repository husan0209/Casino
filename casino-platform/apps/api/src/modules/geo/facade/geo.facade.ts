import { Injectable } from '@nestjs/common'

import type { DisplayCurrency, LegalCountry } from '@casino/shared-config'

import { GetGeoConfigUseCase, type ResolveGeoInput } from '../application/use-cases/get-geo-config.use-case'
import {
  assertFiatDepositMethod,
  convertRubToDisplayAmount,
  getCurrencyLimits,
  resolveLegalCountryForUser,
  toRubEquivalent,
} from '../domain/geo-config.policy'

@Injectable()
export class GeoFacade {
  constructor(private getGeoConfig: GetGeoConfigUseCase) {}

  resolveConfig(input: ResolveGeoInput) {
    return this.getGeoConfig.execute(input)
  }

  validateFiatDepositMethod(country: LegalCountry, currency: string, method: string) {
    return assertFiatDepositMethod(country, currency, method)
  }

  getLimits(currency: DisplayCurrency) {
    return getCurrencyLimits(currency)
  }

  convertRubToDisplay(amountRub: string, currency: DisplayCurrency) {
    return convertRubToDisplayAmount(amountRub, currency)
  }

  toRubEquivalent(amount: string, currency: DisplayCurrency) {
    return toRubEquivalent(amount, currency)
  }

  resolveLegalCountry(countryCode: string | null | undefined) {
    return resolveLegalCountryForUser(countryCode)
  }
}
