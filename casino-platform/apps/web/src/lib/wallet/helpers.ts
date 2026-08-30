import type { WalletBalance } from '@/types/wallet'

import { money } from '@casino/shared-utils'

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
