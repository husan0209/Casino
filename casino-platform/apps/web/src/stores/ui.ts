'use client'
import { create } from 'zustand'

export interface LaunchCurrencyOptions {
  slug: string
  activeCurrency: string
  targetCurrency: string
  targetAmount: string
  onPlayInTarget?: () => void
}

interface UIState {
  loginSheet: boolean
  depositSheet: boolean
  walletSwitcher: boolean
  launchCurrencySheet: boolean
  launchCurrencyOptions: LaunchCurrencyOptions | null
  pendingGameSlug: string | null
  depositCurrency?: string
  openLogin: (gameSlug?: string) => void
  closeLogin: () => void
  openDeposit: (currency?: string) => void
  closeDeposit: () => void
  openWalletSwitcher: () => void
  closeWalletSwitcher: () => void
  openLaunchCurrency: (opts: LaunchCurrencyOptions) => void
  closeLaunchCurrency: () => void
}

export const useUIStore = create<UIState>((set) => ({
  loginSheet: false,
  depositSheet: false,
  walletSwitcher: false,
  launchCurrencySheet: false,
  launchCurrencyOptions: null,
  pendingGameSlug: null,
  openLogin: (gameSlug) => set({ loginSheet: true, pendingGameSlug: gameSlug ?? null }),
  closeLogin: () => set({ loginSheet: false }),
  openDeposit: (currency) => set({ depositSheet: true, depositCurrency: currency }),
  closeDeposit: () => set({ depositSheet: false, depositCurrency: undefined }),
  openWalletSwitcher: () => set({ walletSwitcher: true }),
  closeWalletSwitcher: () => set({ walletSwitcher: false }),
  openLaunchCurrency: (opts) => set({ launchCurrencySheet: true, launchCurrencyOptions: opts }),
  closeLaunchCurrency: () => set({ launchCurrencySheet: false, launchCurrencyOptions: null }),
}))
