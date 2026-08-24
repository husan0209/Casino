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
  fetchWallets: () => Promise<void>
  setActiveCurrency: (currency: string) => Promise<void>
  setLastPlayed: (slug: string, currency: string) => void
  getActiveWallet: () => WalletBalance | undefined
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
      fetchWallets: async () => {
        set({ isLoading: true })
        try {
          const wallets = await fetchBalances()
          const active = get().activeCurrency
          set({ wallets, isLoading: false, activeCurrency: active || wallets[0]?.currency || 'RUB' })
        } catch {
          set({ isLoading: false })
        }
      },
      setActiveCurrency: async (currency) => {
        try {
          await setActiveCurrency(currency)
        } catch { /* guest / offline */ }
        set({ activeCurrency: currency })
      },
      setLastPlayed: (slug, currency) => set({ lastPlayedSlug: slug, lastPlayedCurrency: currency }),
      getActiveWallet: () => {
        const { wallets, activeCurrency } = get()
        return wallets.find((w) => w.currency === activeCurrency)
      },
      refreshActive: async () => get().fetchWallets(),
    }),
    { name: 'casino-web-wallet', partialize: (s) => ({ activeCurrency: s.activeCurrency, lastPlayedCurrency: s.lastPlayedCurrency }) },
  ),
)
