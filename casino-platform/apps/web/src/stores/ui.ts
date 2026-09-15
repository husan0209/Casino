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
  /** GAP-55 (з) §10.3/§16.1: касса вывода — глобальный sheet (открывается и поверх игры). */
  withdrawSheet: boolean
  withdrawCurrency?: string | undefined
  walletSwitcher: boolean
  launchCurrencySheet: boolean
  launchCurrencyOptions: LaunchCurrencyOptions | null
  pendingGameSlug: string | null
  depositCurrency?: string | undefined
  openLogin: (gameSlug?: string) => void
  closeLogin: () => void
  openDeposit: (currency?: string) => void
  closeDeposit: () => void
  openWithdraw: (currency?: string) => void
  closeWithdraw: () => void
  openWalletSwitcher: () => void
  closeWalletSwitcher: () => void
  openLaunchCurrency: (opts: LaunchCurrencyOptions) => void
  closeLaunchCurrency: () => void
}

export const useUIStore = create<UIState>((set) => ({
  loginSheet: false,
  depositSheet: false,
  withdrawSheet: false,
  walletSwitcher: false,
  launchCurrencySheet: false,
  launchCurrencyOptions: null,
  pendingGameSlug: null,
  openLogin: (gameSlug) => set({ loginSheet: true, pendingGameSlug: gameSlug ?? null }),
  closeLogin: () => set({ loginSheet: false }),
  openDeposit: (currency) => set({ depositSheet: true, depositCurrency: currency }),
  closeDeposit: () => set({ depositSheet: false, depositCurrency: undefined }),
  openWithdraw: (currency) => set({ withdrawSheet: true, withdrawCurrency: currency }),
  closeWithdraw: () => set({ withdrawSheet: false, withdrawCurrency: undefined }),
  openWalletSwitcher: () => set({ walletSwitcher: true }),
  closeWalletSwitcher: () => set({ walletSwitcher: false }),
  openLaunchCurrency: (opts) => set({ launchCurrencySheet: true, launchCurrencyOptions: opts }),
  closeLaunchCurrency: () => set({ launchCurrencySheet: false, launchCurrencyOptions: null }),
}))
