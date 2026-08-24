import { AppError } from '@casino/shared-utils'

export class FiatCurrencyNotLiveError extends AppError {
  readonly code = 'FIAT_CURRENCY_NOT_LIVE'
  readonly httpStatus = 422
  constructor(currency: string) {
    super(`Fiat deposits for ${currency} are not available yet`, { currency })
  }
}
