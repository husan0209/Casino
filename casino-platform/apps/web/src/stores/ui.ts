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
  loginSheetMode: 'login' | 'register'
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
  openRegister: () => void
  setLoginSheetMode: (mode: 'login' | 'register') => void
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
  loginSheetMode: 'login',
  depositSheet: false,
  withdrawSheet: false,
  walletSwitcher: false,
  launchCurrencySheet: false,
  launchCurrencyOptions: null,
  pendingGameSlug: null,
  openLogin: (gameSlug) =>
    set({ loginSheet: true, loginSheetMode: 'login', pendingGameSlug: gameSlug ?? null }),
  openRegister: () => set({ loginSheet: true, loginSheetMode: 'register', pendingGameSlug: null }),
  setLoginSheetMode: (loginSheetMode) => set({ loginSheetMode }),
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
