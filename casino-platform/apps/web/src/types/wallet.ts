export type FiatCurrency = 'RUB' | 'UAH' | 'BYN' | 'KZT' | 'UZS'

export interface PaymentMethod {
  id: string
  label: string
  currency: string
  type: 'fiat' | 'crypto'
}

export interface GeoConfig {
  hostname: string
  legalCountry: string
  defaultCurrency: FiatCurrency
  activeCurrency: FiatCurrency
  enabledFiat: FiatCurrency[]
  enabledCrypto: string[]
  paymentMethods: PaymentMethod[]
  cryptoMethods: PaymentMethod[]
  depositPresets: string[]
  depositMin: string
  depositMax: string
  fiatDepositsLive: boolean
}

export interface WalletBalance {
  currency: string
  balance: string
  locked: string
  available: string
}
