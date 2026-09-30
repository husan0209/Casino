'use client'
import { useEffect } from 'react'

/** Имя cookie, которую ставит трекинг-эндпоинт (см. affiliate-tracking.controller). */
const AFFILIATE_COOKIE = 'aff_code'
/** Ключ в localStorage — дубль cookie для переживания ITP-усечения. */
const AFFILIATE_STORAGE_KEY = 'aff_code'

/**
 * Захват партнёрского кода из cookie в localStorage.
 *
 * ЗАЧЕМ. `/go/:code` ставит cookie `aff_code` на 30 дней, но Safari (ITP) и
 * Firefox (ETP) усекают срок жизни cookie для JS-контекста до 7 дней, а при
 * переходе между доменами cookie может не отправиться вовсе. Копия в
 * localStorage живёт весь срок и читается при регистрации — это дешёвый
 * «cookieless-lite» без внешних трекеров (S2S postback остаётся фазой 2).
 *
 * Приоритет при регистрации (ТЗ ч.8 §7.3): `?ref=` в URL → localStorage →
 * cookie. Явная передача — более сильный сигнал намерения, чем оставленная
 * с прошлого визита cookie.
 *
 * Компонент монтируется в корневом layout, поэтому работает на всех страницах.
 */
export function AffiliateCodeCapture(): null {
  useEffect(() => {
    const fromCookie = readCookie(AFFILIATE_COOKIE)
    if (fromCookie === null) {
      return
    }
    const stored = readStorage()
    if (stored !== fromCookie) {
      writeStorage(fromCookie)
    }
  }, [])

  return null
}

/**
 * Текущий партнёрский код: localStorage → cookie.
 *
 * Экспортируется для страницы регистрации. Взвращает null, если кода нет, —
 * регистрация обычного игрока должна работать без партнёрского кода.
 */
export function getAffiliateCode(): string | null {
  const fromStorage = readStorage()
  if (fromStorage !== null) {
    return fromStorage
  }
  return readCookie(AFFILIATE_COOKIE)
}

function readStorage(): string | null {
  try {
    const value = window.localStorage.getItem(AFFILIATE_STORAGE_KEY)
    return value !== null && value.length > 0 ? value : null
  } catch {
    // localStorage недоступен (приватный режим Safari, отключённые куки) —
    // не падаем, просто работаем на cookie.
    return null
  }
}

function writeStorage(value: string): void {
  try {
    window.localStorage.setItem(AFFILIATE_STORAGE_KEY, value)
  } catch {
    // Квота/приватный режим — код доживёт в cookie.
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null
  }
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      const value = decodeURIComponent(rest.join('='))
      return value.length > 0 ? value : null
    }
  }
  return null
}
