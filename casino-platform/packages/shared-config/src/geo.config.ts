export type LegalCountry = 'RU' | 'KZ' | 'UZ' | 'UA' | 'BY' | 'INTL'
export type FiatCurrency = 'RUB' | 'UAH' | 'BYN' | 'KZT' | 'UZS'
export type CryptoCurrency = 'USDT_TRC20' | 'BTC'
export type DisplayCurrency = FiatCurrency | CryptoCurrency

export type PaymentMethodType = 'fiat' | 'crypto'

export interface PaymentMethodDef {
  id: string
  label: string
  currency: DisplayCurrency
  type: PaymentMethodType
}

export interface CurrencyLimitsDef {
  depositMin: string
  depositMax: string
  withdrawMin: string
  withdrawMax: string
  depositPresets: string[]
  /** MVP: live fiat deposit via PSP */
  fiatLive: boolean
}

export interface GeoProfileDef {
  legalCountry: LegalCountry
  defaultCurrency: FiatCurrency
  enabledFiat: FiatCurrency[]
  enabledCrypto: CryptoCurrency[]
  fiatMethods: PaymentMethodDef[]
}

/** Display-only rates: 1 unit of currency → RUB (for KYC limit UI) */
export const DISPLAY_RUB_RATES: Record<DisplayCurrency, string> = {
  RUB: '1',
  UAH: '2.5',
  BYN: '28',
  KZT: '0.18',
  UZS: '0.007',
  USDT_TRC20: '92.5',
  BTC: '8500000',
}

export const CURRENCY_LIMITS: Record<DisplayCurrency, CurrencyLimitsDef> = {
  RUB: {
    depositMin: '100',
    depositMax: '500000',
    withdrawMin: '500',
    withdrawMax: '200000',
    depositPresets: ['1000', '2000', '5000', '10000'],
    fiatLive: true,
  },
  UAH: {
    depositMin: '200',
    depositMax: '200000',
    withdrawMin: '200',
    withdrawMax: '80000',
    depositPresets: ['500', '1000', '2000', '5000'],
    fiatLive: false,
  },
  BYN: {
    depositMin: '10',
    depositMax: '10000',
    withdrawMin: '15',
    withdrawMax: '5000',
    depositPresets: ['30', '50', '100', '200'],
    fiatLive: false,
  },
  KZT: {
    depositMin: '2000',
    depositMax: '25000000',
    withdrawMin: '3000',
    withdrawMax: '10000000',
    depositPresets: ['5000', '10000', '20000', '50000'],
    fiatLive: false,
  },
  UZS: {
    depositMin: '50000',
    depositMax: '500000000',
    withdrawMin: '100000',
    withdrawMax: '200000000',
    depositPresets: ['100000', '200000', '500000', '1000000'],
    fiatLive: false,
  },
  USDT_TRC20: {
    depositMin: '10',
    depositMax: '50000',
    withdrawMin: '20',
    withdrawMax: '20000',
    depositPresets: ['20', '50', '100', '200'],
    fiatLive: false,
  },
  BTC: {
    depositMin: '0.0001',
    depositMax: '2',
    withdrawMin: '0.0002',
    withdrawMax: '1',
    depositPresets: [],
    fiatLive: false,
  },
}

const CRYPTO_METHODS: PaymentMethodDef[] = [
  { id: 'usdt_trc20', label: 'USDT TRC20', currency: 'USDT_TRC20', type: 'crypto' },
  { id: 'btc', label: 'BTC', currency: 'BTC', type: 'crypto' },
]

export const GEO_PROFILES: Record<LegalCountry, GeoProfileDef> = {
  RU: {
    legalCountry: 'RU',
    defaultCurrency: 'RUB',
    enabledFiat: ['RUB'],
    enabledCrypto: ['USDT_TRC20', 'BTC'],
    fiatMethods: [
      { id: 'sbp', label: 'СБП', currency: 'RUB', type: 'fiat' },
      { id: 'card', label: 'Карта', currency: 'RUB', type: 'fiat' },
      { id: 'p2p', label: 'P2P', currency: 'RUB', type: 'fiat' },
    ],
  },
  KZ: {
    legalCountry: 'KZ',
    defaultCurrency: 'KZT',
    enabledFiat: ['KZT'],
    enabledCrypto: ['USDT_TRC20', 'BTC'],
    fiatMethods: [
      { id: 'kaspi', label: 'Kaspi', currency: 'KZT', type: 'fiat' },
      { id: 'card_kz', label: 'Карта', currency: 'KZT', type: 'fiat' },
    ],
  },
  UZ: {
    legalCountry: 'UZ',
    defaultCurrency: 'UZS',
    enabledFiat: ['UZS'],
    enabledCrypto: ['USDT_TRC20', 'BTC'],
    fiatMethods: [
      { id: 'uzcard', label: 'Uzcard', currency: 'UZS', type: 'fiat' },
      { id: 'humo', label: 'Humo', currency: 'UZS', type: 'fiat' },
    ],
  },
  UA: {
    legalCountry: 'UA',
    defaultCurrency: 'UAH',
    enabledFiat: ['UAH'],
    enabledCrypto: ['USDT_TRC20', 'BTC'],
    fiatMethods: [
      { id: 'privat24', label: 'Privat24', currency: 'UAH', type: 'fiat' },
      { id: 'card_ua', label: 'Карта', currency: 'UAH', type: 'fiat' },
    ],
  },
  BY: {
    legalCountry: 'BY',
    defaultCurrency: 'BYN',
    enabledFiat: ['BYN'],
    enabledCrypto: ['USDT_TRC20', 'BTC'],
    fiatMethods: [
      { id: 'erip', label: 'ЕРИП', currency: 'BYN', type: 'fiat' },
      { id: 'card_by', label: 'Карта', currency: 'BYN', type: 'fiat' },
    ],
  },
  INTL: {
    legalCountry: 'INTL',
    defaultCurrency: 'RUB',
    enabledFiat: ['RUB'],
    enabledCrypto: ['USDT_TRC20', 'BTC'],
    fiatMethods: [
      { id: 'sbp', label: 'СБП', currency: 'RUB', type: 'fiat' },
      { id: 'card', label: 'Карта', currency: 'RUB', type: 'fiat' },
      { id: 'p2p', label: 'P2P', currency: 'RUB', type: 'fiat' },
    ],
  },
}

/** ISO 3166-1 alpha-2 → legal geo bucket */
export const COUNTRY_TO_GEO: Record<string, LegalCountry> = {
  RU: 'RU',
  KZ: 'KZ',
  UZ: 'UZ',
  UA: 'UA',
  BY: 'BY',
}

export function resolveLegalCountry(input?: string | null): LegalCountry {
  if (!input) return 'RU'
  const code = input.toUpperCase()
  return COUNTRY_TO_GEO[code] ?? 'INTL'
}

/** MVP: only currencies with fiatLive=true accept fiat deposits */
export function liveFiatCurrencies(): FiatCurrency[] {
  return (Object.entries(CURRENCY_LIMITS) as [DisplayCurrency, CurrencyLimitsDef][])
    .filter(([c, l]) => l.fiatLive && c !== 'USDT_TRC20' && c !== 'BTC')
    .map(([c]) => c as FiatCurrency)
}

export function cryptoMethods(): PaymentMethodDef[] {
  return [...CRYPTO_METHODS]
}
