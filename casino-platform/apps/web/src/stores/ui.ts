'use client'
import { create } from 'zustand'

import type { GameDto } from '@/types/casino'

/**
 * Листы уходят с анимацией: close ставит closing-флаг (компонент в это время
 * рисует sheet-panel-out / sheet-backdrop-out), жёсткое скрытие — через
 * SHEET_EXIT_MS, когда exit-анимация (200ms) доиграла. open* сбрасывает
 * closing, чтобы reopen во время закрытия не мигал.
 */
const SHEET_EXIT_MS = 210

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

/** §5: единый лист авторизации — вход и регистрация, отдельные страницы больше нет. */
export type LoginSheetMode = 'login' | 'register'

interface UIState {
  loginSheet: boolean
  loginSheetClosing: boolean
  loginSheetMode: LoginSheetMode
  depositSheet: boolean
  depositSheetClosing: boolean
  /** GAP-55 (з) §10.3/§16.1: касса вывода — глобальный sheet (открывается и поверх игры). */
  withdrawSheet: boolean
  withdrawSheetClosing: boolean
  withdrawCurrency?: string | undefined
  walletSwitcher: boolean
  walletSwitcherClosing: boolean
  launchCurrencySheet: boolean
  launchCurrencySheetClosing: boolean
  launchCurrencyOptions: LaunchCurrencyOptions | null
  gamePreview: GamePreviewOptions | null
  gamePreviewClosing: boolean
  pendingGameSlug: string | null
  depositCurrency?: string | undefined
  openLogin: (gameSlug?: string, mode?: LoginSheetMode) => void
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

type SheetKey =
  | 'loginSheet'
  | 'depositSheet'
  | 'withdrawSheet'
  | 'walletSwitcher'
  | 'launchCurrencySheet'
  | 'gamePreview'

/** Closing-флаг сейчас, жёсткое скрытие — когда exit-анимация доиграла. */
function deferredHide(
  set: (partial: Partial<UIState>) => void,
  get: () => UIState,
  sheet: SheetKey,
): void {
  const closing = `${sheet}Closing` as keyof UIState
  if (get()[closing] === true) {
    return
  }
  set({ [closing]: true } as Partial<UIState>)
  setTimeout(() => set({ [sheet]: false, [closing]: false } as Partial<UIState>), SHEET_EXIT_MS)
}

export const useUIStore = create<UIState>((set, get) => ({
  loginSheet: false,
  loginSheetClosing: false,
  loginSheetMode: 'login',
  depositSheet: false,
  depositSheetClosing: false,
  withdrawSheet: false,
  withdrawSheetClosing: false,
  walletSwitcher: false,
  walletSwitcherClosing: false,
  launchCurrencySheet: false,
  launchCurrencySheetClosing: false,
  launchCurrencyOptions: null,
  gamePreview: null,
  gamePreviewClosing: false,
  pendingGameSlug: null,
  openLogin: (gameSlug, mode) =>
    set({
      loginSheet: true,
      loginSheetClosing: false,
      loginSheetMode: mode ?? 'login',
      pendingGameSlug: gameSlug ?? null,
    }),
  closeLogin: () => deferredHide(set, get, 'loginSheet'),
  openDeposit: (currency) =>
    set({ depositSheet: true, depositSheetClosing: false, depositCurrency: currency }),
  closeDeposit: () => deferredHide(set, get, 'depositSheet'),
  openWithdraw: (currency) =>
    set({ withdrawSheet: true, withdrawSheetClosing: false, withdrawCurrency: currency }),
  closeWithdraw: () => deferredHide(set, get, 'withdrawSheet'),
  openWalletSwitcher: () => set({ walletSwitcher: true, walletSwitcherClosing: false }),
  closeWalletSwitcher: () => deferredHide(set, get, 'walletSwitcher'),
  openLaunchCurrency: (opts) =>
    set({ launchCurrencySheet: true, launchCurrencySheetClosing: false, launchCurrencyOptions: opts }),
  closeLaunchCurrency: () => deferredHide(set, get, 'launchCurrencySheet'),
  openGamePreview: (opts) => set({ gamePreview: opts, gamePreviewClosing: false }),
  closeGamePreview: () => deferredHide(set, get, 'gamePreview'),
}))
