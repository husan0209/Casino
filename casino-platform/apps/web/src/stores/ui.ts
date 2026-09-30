'use client'
import { create } from 'zustand'

import type { GameDto } from '@/types/casino'

export interface LaunchCurrencyOptions {
  slug: string
  activeCurrency: string
  targetCurrency: string
  targetAmount: string
  onPlayInTarget?: () => void
}

/**
 * Превью игры (ТЗ ч.5.1 §4.5: «i» на карточке = превью). Избранное и его
 * переключатель приходят от того, кто открыл шторку: у витрины, избранного и
 * похожих слотов свои списки, и оптимистичный апдейт должен уходить в тот же
 * запрос, из которого карточка уже нарисована.
 */
export interface GamePreviewOptions {
  game: GameDto
  isFavorite: boolean
  onToggleFavorite?: ((game: GameDto) => void) | undefined
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
  gamePreview: GamePreviewOptions | null
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
  openGamePreview: (opts: GamePreviewOptions) => void
  closeGamePreview: () => void
}

export const useUIStore = create<UIState>((set) => ({
  loginSheet: false,
  depositSheet: false,
  withdrawSheet: false,
  walletSwitcher: false,
  launchCurrencySheet: false,
  launchCurrencyOptions: null,
  gamePreview: null,
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
  openGamePreview: (opts) => set({ gamePreview: opts }),
  closeGamePreview: () => set({ gamePreview: null }),
}))
