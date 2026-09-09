'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { apiGet, apiPost, setAccessToken } from '@/lib/api'
import { type AuthState, type WebUser, useAuth } from '@/stores/auth'

/**
 * OAuth-блок входа/регистрации (pre-launch: ТЗ ч.2 UC-AUTH-08/09).
 * Google: GET /auth/google/url → редирект на Google → /auth/google/callback
 *         обменивает code на сессию (state — подписанный CSRF-токен API).
 * Telegram: Login Widget (data-telegram-login) → глобальный колбэк
 *         onTelegramAuth → POST /auth/telegram с widget-пейлоадом.
 *
 * Появляется ТОЛЬКО когда соответствующие публичные ключи заданы
 * (NEXT_PUBLIC_GOOGLE_CLIENT_ID / NEXT_PUBLIC_TELEGRAM_BOT_NAME) — без ключей
 * блок не рендерится вовсе, как и раньше («подключается при наличии ключей»).
 * Реферальный код подхватывается из ?ref= (register) и передаётся в оба потока.
 */

const GOOGLE_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID']
const TELEGRAM_BOT_NAME = process.env['NEXT_PUBLIC_TELEGRAM_BOT_NAME']
const APP_ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''

/** Telegram widget-пейлоад (ТЗ ч.2 UC-AUTH-09; zod-passthrough на API). */
interface TelegramWidgetUser {
  id: string
  auth_date: string
  hash: string
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramWidgetUser) => void
  }
}

export function OAuthButtons({ referralCode }: { referralCode?: string }): React.JSX.Element | null {
  const setSession = useAuth((s: AuthState) => s.setSession)
  const router = useRouter()
  const telegramContainer = useRef<HTMLDivElement>(null)
  const [telegramBusy, setTelegramBusy] = useState(false)

  const finishSignIn = (accessToken: string, user: WebUser): void => {
    setAccessToken(accessToken)
    setSession(accessToken, user)
    router.push('/profile')
  }

  // Telegram Login Widget: скрипт монтируется один раз, колбэк глобальный.
  useEffect((): void => {
    if (!TELEGRAM_BOT_NAME || telegramContainer.current === null) {
      return
    }
    window.onTelegramAuth = (user: TelegramWidgetUser): void => {
      setTelegramBusy(true)
      apiPost<{ accessToken: string; user: WebUser }>('/auth/telegram', {
        ...user,
        referral_code: referralCode,
      })
        .then((res) => {
          finishSignIn(res.accessToken, res.user)
        })
        .catch(() => {
          setTelegramBusy(false)
        })
    }
    const s = document.createElement('script')
    s.src = 'https://telegram.org/js/telegram-widget.js?22'
    s.async = true
    s.setAttribute('data-telegram-login', TELEGRAM_BOT_NAME)
    s.setAttribute('data-size', 'large')
    s.setAttribute('data-radius', '8')
    s.setAttribute('data-onauth', 'onTelegramAuth(user)')
    s.setAttribute('data-request-access', 'write')
    telegramContainer.current.appendChild(s)
    return () => {
      delete window.onTelegramAuth
    }
  }, [referralCode])

  const startGoogle = async (): Promise<void> => {
    // redirect_uri — текущий origin; API валидирует по allowlist и строит
    // подписанный state (CSRF). referral_code в state не влезает (подпись) —
    // он передаётся при обмене code (POST /auth/google) с той же страницы.
    const redirectUri = `${APP_ORIGIN}/auth/google/callback`
    const { url } = await apiGet<{ url: string; state: string }>('/auth/google/url', {
      redirect_uri: redirectUri,
    })
    if (referralCode) {
      sessionStorage.setItem('oauth_referral_code', referralCode)
    }
    window.location.assign(url)
  }

  if (!GOOGLE_CLIENT_ID && !TELEGRAM_BOT_NAME) {
    return null
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 text-xs text-muted mb-2">
        <span className="flex-1 border-t border-[#2A2A4A]" />
        или
        <span className="flex-1 border-t border-[#2A2A4A]" />
      </div>
      <div className="space-y-2">
        {GOOGLE_CLIENT_ID !== undefined && (
          <button className="btn w-full" type="button" onClick={() => void startGoogle()}>
            Войти через Google
          </button>
        )}
        {TELEGRAM_BOT_NAME !== undefined && (
          <div ref={telegramContainer} className="flex justify-center min-h-10 items-center">
            {telegramBusy && <span className="text-xs text-muted">Проверяем Telegram-подпись…</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Обмен code на сессию — вызывается со страницы /auth/google/callback. */
export async function exchangeGoogleCode(): Promise<{ accessToken: string; user: WebUser }> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  if (error !== null || code === null) {
    throw new Error(error ?? 'no code')
  }
  const referralCode = sessionStorage.getItem('oauth_referral_code') ?? undefined
  const res = await apiPost<{ accessToken: string; user: WebUser }>('/auth/google', {
    code,
    redirect_uri: `${window.location.origin}/auth/google/callback`,
    referral_code: referralCode,
  })
  sessionStorage.removeItem('oauth_referral_code')
  return res
}
