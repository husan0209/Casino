'use client'

import { apiGet, apiPost } from '@/lib/api'
import { type WebUser } from '@/stores/auth'

/**
 * OAuth-блок (pre-launch: ТЗ ч.2 UC-AUTH-08) — единственный на весь веб:
 * живёт внутри LoginSheet (§5), отдельные страницы входа/регистрации убраны.
 * Google: GET /auth/google/url → редирект на Google → /auth/google/callback
 *         обменивает code на сессию (state — подписанный CSRF-токен API).
 * Telegram: настоящий виджет (UC-AUTH-09) отложен до настройки бота и домена
 *         (тот же контур, что GAP-46) — в листе пока заглушка с фирменным знаком.
 *
 * Кнопка Google рисует реальный поток только когда задан
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID — «подключается при наличии ключей».
 * Реферальный код (§5.1: из ?ref= — тихо) передаётся в поток.
 */

export const GOOGLE_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID']

/** Единый стиль OAuth-плашек листа (Google/Telegram). */
export const OAUTH_BUTTON_CLASS =
  'flex w-full items-center justify-center gap-3 rounded-xl border border-[#2A2A4A] bg-white/[0.04] px-4 py-3 text-sm font-medium transition hover:bg-white/[0.07]'

/** Официальный четырёхцветный знак Google (брендинг «Sign in with Google»). */
export function GoogleMark({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#EA4335"
        d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z"
      />
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#FBBC05"
        d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9.008 9.008 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z"
      />
    </svg>
  )
}

/** Официальный знак Telegram (Wikimedia Commons, viewBox 240): градиентный круг + самолёт. */
export function TelegramMark({ size = 24 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" aria-hidden>
      <defs>
        <linearGradient
          id="tg-mark-gradient"
          gradientUnits="userSpaceOnUse"
          x1="120"
          y1="240"
          x2="120"
          y2="0"
        >
          <stop offset="0" stopColor="#1d93d2" />
          <stop offset="1" stopColor="#38b0e3" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="120" r="120" fill="url(#tg-mark-gradient)" />
      <path
        fill="#c8daea"
        d="M81.229,128.772l14.237,39.406s1.78,3.687,3.686,3.687,30.255-29.492,30.255-29.492l31.525-60.89L81.737,118.6Z"
      />
      <path
        fill="#a9c6d8"
        d="M100.106,138.878l-2.733,29.046s-1.144,8.9,7.754,0,17.415-15.763,17.415-15.763"
      />
      <path
        fill="#fff"
        d="M81.486,130.178,52.2,120.636s-3.5-1.42-2.373-4.64c.232-.664.7-1.229,2.1-2.2,6.489-4.523,120.106-45.36,120.106-45.36s3.208-1.081,5.1-.362a2.766,2.766,0,0,1,1.885,2.055,9.357,9.357,0,0,1,.254,2.585c-.009.752-.1,1.449-.169,2.542-.692,11.165-21.4,94.493-21.4,94.493s-1.239,4.876-5.678,5.043A8.13,8.13,0,0,1,146.1,172.5c-8.711-7.493-38.819-27.727-45.472-32.177a1.27,1.27,0,0,1-.546-.9c-.093-.469.417-1.05.417-1.05s52.426-46.6,53.821-51.492c.108-.379-.3-.566-.848-.4-3.482,1.281-63.844,39.4-70.506,43.607A3.21,3.21,0,0,1,81.486,130.178Z"
      />
    </svg>
  )
}

export const startGoogleOAuth = async (referralCode?: string): Promise<void> => {
  // redirect_uri — текущий origin; API валидирует по allowlist и строит
  // подписанный state (CSRF). referral_code в state не влезает (подпись) —
  // он передаётся при обмене code (POST /auth/google) с той же страницы.
  const { url } = await apiGet<{ url: string; state: string }>('/auth/google/url', {
    redirect_uri: `${window.location.origin}/auth/google/callback`,
  })
  if (referralCode) {
    sessionStorage.setItem('oauth_referral_code', referralCode)
  }
  window.location.assign(url)
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
