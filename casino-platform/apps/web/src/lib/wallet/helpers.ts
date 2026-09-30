import { isCryptoCurrency } from '@/lib/format/currency'
import type { WalletBalance } from '@/types/wallet'

import { money } from '@casino/shared-utils'

/**
 * Кошелёк существует для каждой включённой в гео-конфиге валюты, даже с нулём:
 * `/wallet/balances` отдаёт только профинансированные, иначе пользователь не
 * увидел бы, куда ему пополнять. Валюты вне конфига, но с балансом сохраняем —
 * спрятать чужие деньги хуже, чем показать лишнюю строку.
 */
export function mergeWallets(balances: WalletBalance[], enabled: string[]): WalletBalance[] {
  const map = new Map(balances.map((w) => [w.currency, w]))
  const extra = balances
    .filter((w) => !enabled.includes(w.currency))
    .map((w) => w.currency)
  return [...enabled, ...extra].map(
    (currency) => map.get(currency) ?? { currency, balance: '0', locked: '0', available: '0' },
  )
}

export function sortWallets(wallets: WalletBalance[], activeCurrency: string): WalletBalance[] {
  return [...wallets].sort((a, b) => {
    if (a.currency === activeCurrency) {
      return -1
    }
    if (b.currency === activeCurrency) {
      return 1
    }
    const aPos = money.isPositive(a.available)
    const bPos = money.isPositive(b.available)
    if (aPos && !bPos) {
      return -1
    }
    if (!aPos && bPos) {
      return 1
    }
    return a.currency.localeCompare(b.currency)
  })
}

/**
 * Группы «Фиат» / «Крипта» одним проходом. Принадлежность — по коду валюты
 * (`isCryptoCurrency`), а списки гео-конфига только добавляют пустые строки туда,
 * куда игроку стоит пополнять. Делить надо именно вместе: `mergeWallets` дописывает
 * валюты вне своего списка, и два независимых вызова по полному списку кладут одну
 * и ту же строку в обе группы — в шторке кошельков рубль светился и в «ФИАТ»,
 * и в «КРИПТА».
 */
export function splitWalletsByKind(
  balances: WalletBalance[],
  groups: { enabledFiat: string[]; enabledCrypto: string[]; activeCurrency: string },
): { fiat: WalletBalance[]; crypto: WalletBalance[] } {
  const { enabledFiat, enabledCrypto, activeCurrency } = groups
  const fiat = balances.filter((w) => !isCryptoCurrency(w.currency))
  const crypto = balances.filter((w) => isCryptoCurrency(w.currency))
  return {
    fiat: sortWallets(mergeWallets(fiat, enabledFiat), activeCurrency),
    crypto: sortWallets(mergeWallets(crypto, enabledCrypto), activeCurrency),
  }
}

/** First wallet with funds in a currency other than the active one */
export function findFundedAlternative(
  wallets: WalletBalance[],
  activeCurrency: string,
): WalletBalance | undefined {
  return wallets.find((w) => w.currency !== activeCurrency && money.isPositive(w.available))
}

export function isWalletEmpty(wallets: WalletBalance[], currency: string): boolean {
  const w = wallets.find((x) => x.currency === currency)
  return !w || !money.isPositive(w.available)
}
