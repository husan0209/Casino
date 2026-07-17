export type MoneyAmount = string
export type Currency = 'RUB' | 'USDT_TRC20' | 'BTC' | 'TON' | 'TRX' | 'LTC'
export interface Money { readonly amount: MoneyAmount; readonly currency: Currency }
export const ZERO: Record<Currency, MoneyAmount> = { RUB:'0.00', USDT_TRC20:'0.00000000', BTC:'0.00000000', TON:'0.00000000', TRX:'0.00000000', LTC:'0.00000000' }
export const CURRENCY_DECIMALS: Record<Currency, number> = { RUB:2, USDT_TRC20:8, BTC:8, TON:8, TRX:8, LTC:8 }
