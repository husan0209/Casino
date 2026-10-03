import { Inject, Injectable } from '@nestjs/common'

import type { DisplayCurrency, LegalCountry, PaymentMethodDef } from '@casino/shared-config'

import { ExchangeRatesService } from '../application/exchange-rates.service'
import {
  GetGeoConfigUseCase,
  type ResolveGeoInput,
} from '../application/use-cases/get-geo-config.use-case'
import {
  type GeoConfigResult,
  assertFiatDepositMethod,
  convertRubToDisplayAmount,
  getCurrencyLimits,
  resolveLegalCountryForUser,
  toRubEquivalent,
} from '../domain/geo-config.policy'

/** В4: presentation импортирует форму ответа только из фасада (публичный API
 *  модуля), а не из домена. `GeoConfigResult` не уезжает в @casino/shared-types,
 *  потому что построен из типов @casino/shared-config (LegalCountry,
 *  FiatCurrency, PaymentMethodDef) — перенос заставил бы leaf-пакет типов
 *  зависеть от пакета конфигурации и дублировал бы его юнионы.
 *  Образец такого же DTO-типа фасада: WalletBalanceView (wallet.facade.ts). */
export type { GeoConfigResult }

@Injectable()
export class GeoFacade {
  constructor(
    @Inject(GetGeoConfigUseCase) private getGeoConfig: GetGeoConfigUseCase,
    @Inject(ExchangeRatesService) private rates: ExchangeRatesService,
  ) {}

  resolveConfig(input: ResolveGeoInput): Promise<GeoConfigResult> {
    return this.getGeoConfig.execute(input)
  }

  validateFiatDepositMethod(
    country: LegalCountry,
    currency: string,
    method: string,
  ): PaymentMethodDef {
    return assertFiatDepositMethod(country, currency, method)
  }

  getLimits(currency: DisplayCurrency): ReturnType<typeof getCurrencyLimits> {
    return getCurrencyLimits(currency)
  }

  /** GAP-34: крипто-курс из БД/кеша (fallback — константы); фиат — политические константы */
  async convertRubToDisplay(amountRub: string, currency: DisplayCurrency): Promise<string> {
    const { rate } = await this.rates.getRubRate(currency)
    return convertRubToDisplayAmount(amountRub, currency, rate)
  }

  toRubEquivalent(amount: string, currency: DisplayCurrency): string {
    return toRubEquivalent(amount, currency)
  }

  resolveLegalCountry(countryCode: string | null | undefined): LegalCountry {
    return resolveLegalCountryForUser(countryCode)
  }
}
