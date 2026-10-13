'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { fetchBalances, setActiveCurrency } from '@/lib/api/wallet.api'
import type { WalletBalance } from '@/types/wallet'

interface WalletState {
  wallets: WalletBalance[]
  activeCurrency: string
  lastPlayedCurrency: string | null
  lastPlayedSlug: string | null
  isLoading: boolean
  /** Был ли хотя бы один успешный ответ по балансам (см. `getLaunchBalance`). */
  loaded: boolean
  fetchWallets: () => Promise<void>
  setActiveCurrency: (currency: string) => Promise<void>
  setLastPlayed: (slug: string, currency: string) => void
  getActiveWallet: () => WalletBalance | undefined
  getLaunchBalance: () => string | null
  refreshActive: () => Promise<void>
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      wallets: [],
      activeCurrency: 'RUB',
      lastPlayedCurrency: null,
      lastPlayedSlug: null,
      isLoading: false,
      loaded: false,
      fetchWallets: async () => {
        set({ isLoading: true })
        try {
          const wallets = await fetchBalances()
          const active = get().activeCurrency
          set({
            wallets,
            isLoading: false,
            loaded: true,
            activeCurrency: active || wallets[0]?.currency || 'RUB',
          })
        } catch {
          set({ isLoading: false })
        }
      },
      setActiveCurrency: async (currency) => {
        try {
          await setActiveCurrency(currency)
        } catch {
          /* guest / offline */
        }
        set({ activeCurrency: currency })
      },
      setLastPlayed: (slug, currency) =>
        set({ lastPlayedSlug: slug, lastPlayedCurrency: currency }),
      getActiveWallet: () => {
        const { wallets, activeCurrency } = get()
        return wallets.find((w) => w.currency === activeCurrency)
      },
      /**
       * Баланс для развилки «запуск или касса» (`realMoneyStep`). `null` —
       * балансы ещё не пришли, выдумывать нечем. «0» — пришли, а активного
       * кошелька нет: у нового игрока бэк отдаёт `[]`, и без этого случая тап
       * «Играть на деньги» уходил на страницу игры и возвращался кассой через
       * серверный `INSUFFICIENT_FUNDS` — лишний прыжок вместо кассы сразу.
       */
      getLaunchBalance: (): string | null => {
        const wallet = get().getActiveWallet()
        if (wallet) {
          return wallet.available
        }
        return get().loaded ? '0' : null
      },
      refreshActive: async () => get().fetchWallets(),
    }),
    {
      name: 'casino-web-wallet',
      partialize: (s) => ({
        activeCurrency: s.activeCurrency,
        lastPlayedCurrency: s.lastPlayedCurrency,
      }),
    },
  ),
)
