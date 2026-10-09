'use client'

import { useEffect } from 'react'

import { detectTelegramWebApp, ensureTelegramWebAppBridge } from '@/lib/telegram-webapp'

/**
 * Наш цвет оболочки — тот же, что в `viewport.themeColor` (app/layout.tsx) и в
 * `bg-[#0F0F1A]` шапки/фона.
 */
const SURFACE_COLOR = '#0F0F1A'

/**
 * Поведение окна Telegram Mini App (GAP-21).
 *
 * Без `expand()` клиент открывает приложение половинкой экрана — игрок видит
 * «карточку поверх чата», а не сайт, и нижняя навигация оказывается отрезана.
 * Цвет шапки и фона по умолчанию берётся из темы Telegram, поэтому в тёмной
 * теме нашей кассы сверху остаётся чужая серая полоса: красим оба в свой цвет,
 * ничего не подмешивая из темы игрока.
 *
 * Вне Telegram хук не делает ничего — ни одного обращения к стороннему скрипту.
 */
export function useTelegramSurface(): void {
  useEffect((): (() => void) => {
    if (!detectTelegramWebApp()) {
      return (): void => undefined
    }
    let cancelled = false
    void ensureTelegramWebAppBridge().then((bridge): void => {
      if (bridge === null || cancelled) {
        return
      }
      bridge.ready?.()
      bridge.expand?.()
      bridge.setHeaderColor?.(SURFACE_COLOR)
      bridge.setBackgroundColor?.(SURFACE_COLOR)
    })
    return (): void => {
      cancelled = true
    }
  }, [])
}
