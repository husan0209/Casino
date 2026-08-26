'use client'
import { useEffect } from 'react'

import { formatBalance } from '@/lib/format/currency'
import { sortWallets } from '@/lib/wallet/helpers'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'
import type { WalletBalance } from '@/types/wallet'

import { money } from '@casino/shared-utils'

const CRYPTO_LABELS: Record<string, string> = {
  USDT_TRC20: 'USDT',
  BTC: 'BTC',
}

function displayLabel(currency: string): string {
  return CRYPTO_LABELS[currency] ?? currency
}

function mergeWallets(balances: WalletBalance[], enabled: string[]): WalletBalance[] {
  const map = new Map(balances.map((w) => [w.currency, w]))
  return enabled.map((currency) =>
    map.get(currency) ?? { currency, balance: '0', locked: '0', available: '0' },
  )
}

export function WalletSwitcher() {
  const { walletSwitcher, closeWalletSwitcher } = useUIStore()
  const { wallets, activeCurrency, fetchWallets, setActiveCurrency } = useWalletStore()
  const { config, load } = useGeoStore()

  useEffect(() => {
    if (walletSwitcher) {
      void load()
      void fetchWallets()
    }
  }, [walletSwitcher, load, fetchWallets])

  if (!walletSwitcher) return null

  const enabled = [
    ...(config?.enabledFiat ?? ['RUB']),
    ...(config?.enabledCrypto ?? []),
  ]
  const list = sortWallets(mergeWallets(wallets, enabled), activeCurrency)

  const pick = async (currency: string) => {
    await setActiveCurrency(currency)
    closeWalletSwitcher()
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={closeWalletSwitcher} />
      <div className="sheet-panel">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Кошелёк</h2>
          <button type="button" onClick={closeWalletSwitcher} className="text-muted">✕</button>
        </div>
        <ul className="mt-4 space-y-1">
          {list.map((w) => {
            const active = w.currency === activeCurrency
            const empty = !money.isPositive(w.available)
            return (
              <li key={w.currency}>
                <button
                  type="button"
                  onClick={() => pick(w.currency)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm transition hover:bg-white/5 ${empty ? 'text-muted' : ''}`}
                >
                  <span>{active ? '✓ ' : ''}{displayLabel(w.currency)}</span>
                  <span className={empty ? 'text-muted/70' : 'font-medium'}>
                    {formatBalance(w.available, w.currency)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
