import {
  DISPLAY_RUB_RATES,
  GEO_PROFILES,
  GeoProfileDef,
  FiatCurrency,
  LegalCountry,
  PaymentMethodDef,
  cryptoMethods,
  liveFiatCurrencies,
  resolveLegalCountry,
  type DisplayCurrency,
  CURRENCY_LIMITS,
} from '@casino/shared-config'
import { money } from '@casino/shared-utils'
import { FiatCurrencyNotLiveError, PaymentMethodUnavailableError } from './errors'

export interface UserGeoContext {
  currencyPreference: string | null
  lastPaymentMethod: string | null
  country: string | null
}

export interface GeoConfigResult {
  hostname: string
  legalCountry: LegalCountry
  defaultCurrency: FiatCurrency
  activeCurrency: FiatCurrency
  enabledFiat: FiatCurrency[]
  enabledCrypto: Array<'USDT_TRC20' | 'BTC'>
  paymentMethods: PaymentMethodDef[]
  cryptoMethods: PaymentMethodDef[]
  depositPresets: string[]
  depositMin: string
  depositMax: string
  fiatDepositsLive: boolean
}

export function resolveGeoConfig(input: {
  hostname?: string
  countryCode?: string | null
  userContext?: UserGeoContext | null
}): GeoConfigResult {
  const legalCountry = resolveLegalCountry(input.userContext?.country || input.countryCode)
  const profile = GEO_PROFILES[legalCountry]
  const activeCurrency = resolveActiveCurrency(profile, input.userContext?.currencyPreference)
  const enabledFiat = profile.enabledFiat.filter((c) => liveFiatCurrencies().includes(c))
  const fiatMethods = filterMethodsForCurrency(profile.fiatMethods, activeCurrency, enabledFiat)
  const sortedFiat = sortByLastMethod(fiatMethods, input.userContext?.lastPaymentMethod)
  const limits = CURRENCY_LIMITS[activeCurrency] ?? CURRENCY_LIMITS.RUB

  return {
    hostname: input.hostname || 'localhost',
    legalCountry: profile.legalCountry,
    defaultCurrency: profile.defaultCurrency,
    activeCurrency,
    enabledFiat,
    enabledCrypto: profile.enabledCrypto,
    paymentMethods: sortedFiat,
    cryptoMethods: cryptoMethods(),
    depositPresets: limits.depositPresets,
    depositMin: limits.depositMin,
    depositMax: limits.depositMax,
    fiatDepositsLive: limits.fiatLive && enabledFiat.includes(activeCurrency),
  }
}

export function assertFiatDepositMethod(country: LegalCountry, currency: string, method: string): PaymentMethodDef {
  const profile = GEO_PROFILES[country]
  if (!liveFiatCurrencies().includes(currency as FiatCurrency)) {
    throw new FiatCurrencyNotLiveError(currency)
  }
  const found = profile.fiatMethods.find((m) => m.id === method && m.currency === currency)
  if (!found) throw new PaymentMethodUnavailableError()
  return found
}

export function getCurrencyLimits(currency: DisplayCurrency) {
  return CURRENCY_LIMITS[currency] ?? CURRENCY_LIMITS.RUB
}

/** Display-only: RUB remaining → target currency (KYC UI) */
export function convertRubToDisplayAmount(amountRub: string, currency: DisplayCurrency): string {
  if (currency === 'RUB') return amountRub
  const rate = DISPLAY_RUB_RATES[currency] || '1'
  const converted = money.divide(amountRub, rate)
  const [intPart, fracPart = ''] = converted.split('.')
  if (currency === 'BTC') return fracPart ? `${intPart}.${fracPart.slice(0, 8)}` : intPart!
  if (currency === 'USDT_TRC20') return fracPart ? `${intPart}.${fracPart.slice(0, 2)}` : intPart!
  return intPart ?? converted
}

export function toRubEquivalent(amount: string, currency: DisplayCurrency): string {
  if (currency === 'RUB') return amount
  const rate = DISPLAY_RUB_RATES[currency] || '1'
  const converted = money.multiply(amount, rate)
  const [intPart, fracPart = '00'] = converted.split('.')
  return `${intPart}.${fracPart.slice(0, 2)}`
}

export function resolveLegalCountryForUser(countryCode: string | null | undefined): LegalCountry {
  return resolveLegalCountry(countryCode)
}

function resolveActiveCurrency(profile: GeoProfileDef, preference?: string | null): FiatCurrency {
  const pref = preference as FiatCurrency | undefined
  if (pref && profile.enabledFiat.includes(pref)) return pref
  return profile.defaultCurrency
}

function filterMethodsForCurrency(
  methods: PaymentMethodDef[],
  currency: FiatCurrency,
  enabledFiat: FiatCurrency[],
): PaymentMethodDef[] {
  if (!enabledFiat.includes(currency)) return []
  return methods.filter((m) => m.currency === currency && m.type === 'fiat')
}

function sortByLastMethod(methods: PaymentMethodDef[], lastId?: string | null): PaymentMethodDef[] {
  if (!lastId) return methods
  const idx = methods.findIndex((m) => m.id === lastId)
  if (idx <= 0) return methods
  const copy = [...methods]
  const [item] = copy.splice(idx, 1)
  return [item!, ...copy]
}
