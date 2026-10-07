'use client'

import { useEffect, useRef, useState } from 'react'

import { apiGet, apiPost } from '@/lib/api'
import { type WebUser } from '@/stores/auth'

/**
 * OAuth-блок (pre-launch: ТЗ ч.2 UC-AUTH-08/09) — единственный на весь веб:
 * живёт внутри LoginSheet (§5), отдельные страницы входа/регистрации убраны.
 * Google: GET /auth/google/url → редирект на Google → /auth/google/callback
 *         обменивает code на сессию (state — подписанный CSRF-токен API).
 * Telegram: TelegramLoginWidget инжектит официальный скрипт
 *         telegram-widget.js (бот из NEXT_PUBLIC_TELEGRAM_BOT_NAME) в режиме
 *         data-auth-url — после подтверждения Telegram редирект на
 *         /auth/telegram/callback. Там подпись сверяется (POST
 *         /auth/telegram/preview, сессию не выдаёт), игрок видит, под каким
 *         аккаунтом идёт вход, и только по «Продолжить» меняется данные на
 *         сессию (POST /auth/telegram). Iframe виджета рендерится только на
 *         домене, добавленном боту через /setdomain, — на остальных Telegram
 *         показывает ошибку.
 *
 * Кнопка Google рисует реальный поток только когда задан
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID — «подключается при наличии ключей».
 * Реферальный код (§5.1: из ?ref= — тихо) передаётся в поток.
 */

export const GOOGLE_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID']

export const TELEGRAM_BOT_NAME = process.env['NEXT_PUBLIC_TELEGRAM_BOT_NAME']

/** Единый стиль OAuth-плашек листа (Google/Telegram). */
/**
 * Единый стиль OAuth-плашек листа (Google/Telegram).
 *
 * Высота задана явно (`h-10` = 40 px), а не подушкой `py-*`: кнопку Telegram
 * рисует его iframe, и её высота — ровно 40 px, изменить её мы не можем. С
 * `py-3` наша плашка выходила 46 px, и в одном столбце кнопки были разного
 * роста — подстраиваемся под тот размер, который нам не принадлежит. Радиус 12
 * px совпадает с `data-radius` виджета.
 */
export const OAUTH_BUTTON_CLASS =
  'flex h-10 w-full items-center justify-center gap-3 rounded-xl border border-[#2A2A4A] bg-white/[0.04] px-4 text-sm font-medium transition hover:bg-white/[0.07]'

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
    // Google возвращает `state` в query callback-а, и он обязан уехать в тело:
    // API сверяет его с кукой `oauth_state`, выданной на /auth/google/url
    // (защита от login CSRF). Без него обмен отбивается на 400 ещё до Google.
    state: params.get('state') ?? undefined,
    referral_code: referralCode,
  })
  sessionStorage.removeItem('oauth_referral_code')
  return res
}

/** Данные пользователя от Telegram Login Widget (UC-AUTH-09) до обмена на сессию. */
export interface TelegramAuthPayload {
  id: number | string
  auth_date: number | string
  hash: string
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
}

/**
 * Тело запроса к API для обоих шагов: виджет присылает id/auth_date числами,
 * DTO API (TelegramLoginSchema) требует строки — конвертация здесь, остальные
 * поля едут как есть (серверная zod-схема passthrough). Набор ключей общий не
 * для красоты: подпись Telegram считается от них, и если preview и обмен
 * отправят разные поля, один из двух шагов отбивается с «подпись не совпадает».
 */
function telegramDtoBody(payload: TelegramAuthPayload): Record<string, string | undefined> {
  return {
    id: String(payload.id),
    auth_date: String(payload.auth_date),
    hash: payload.hash,
    first_name: payload.first_name,
    last_name: payload.last_name,
    username: payload.username,
    photo_url: payload.photo_url,
  }
}

/**
 * Обмен данных виджета на сессию — POST /auth/telegram. Подпись Telegram
 * проверяет API по HMAC от TELEGRAM_BOT_TOKEN (токен живёт только на сервере).
 */
export async function exchangeTelegramAuth(
  payload: TelegramAuthPayload,
  referralCode?: string,
): Promise<{ accessToken: string; user: WebUser }> {
  return apiPost<{ accessToken: string; user: WebUser }>('/auth/telegram', {
    ...telegramDtoBody(payload),
    referral_code: referralCode,
  })
}

/** Ответ POST /auth/telegram/preview — проверенный профиль до выдачи сессии. */
export interface TelegramPreviewResult {
  displayName: string | null
  username: string | null
  photoUrl: string | null
  accountExists: boolean
}

/**
 * Проверка подписи без входа (экран подтверждения). Имя и фото берём отсюда, а
 * не из query: query подделывается ссылкой вида `…/callback?first_name=Админ`, и
 * наша же страница предлагала бы «продолжить» под выдуманным аккаунтом.
 */
export async function previewTelegramAuth(
  payload: TelegramAuthPayload,
): Promise<TelegramPreviewResult> {
  return apiPost<TelegramPreviewResult>('/auth/telegram/preview', telegramDtoBody(payload))
}

/**
 * Разобрать данные пользователя из query колбэк-страницы. Виджет в режиме
 * data-auth-url делает location.href на auth-url, добавляя поля пользователя
 * (id, auth_date, hash, first_name, …) как query-параметры; обязательны три
 * криптографических поля — без них обмен не начинать.
 */
export function telegramPayloadFromQuery(query: URLSearchParams): TelegramAuthPayload | null {
  const id = query.get('id')
  const authDate = query.get('auth_date')
  const hash = query.get('hash')
  if (id === null || authDate === null || hash === null) {
    return null
  }
  const firstName = query.get('first_name')
  const lastName = query.get('last_name')
  const username = query.get('username')
  const photoUrl = query.get('photo_url')
  return {
    id,
    auth_date: authDate,
    hash,
    ...(firstName !== null && { first_name: firstName }),
    ...(lastName !== null && { last_name: lastName }),
    ...(username !== null && { username }),
    ...(photoUrl !== null && { photo_url: photoUrl }),
  }
}

/**
 * Видимая плашка Telegram. Подпись «Продолжить с Telegram» — по образцу
 * соседней Google-плашки: обе говорят одно и то же про один и тот же шаг.
 */
export function TelegramOAuthPlate(): React.JSX.Element {
  return (
    <>
      <TelegramMark size={20} />
      Продолжить с Telegram
    </>
  )
}

/**
 * Официальный Telegram Login Widget (UC-AUTH-09) в redirect-режиме
 * (data-auth-url): после подтверждения виджет сам переводит страницу на
 * /auth/telegram/callback с данными пользователя в query. Режим выбран вместо
 * data-onauth сознательно: строковый колбэк виджет собирает через
 * Function('user', …) — это eval, который запрещён прод-CSP (P1 #11:
 * script-src без unsafe-eval) и ронял виджет с EvalError.
 *
 * Как выглядит кнопка — наше, а не Telegram: видимая плашка лежит снизу, iframe
 * виджета — прозрачным слоем сверху (`opacity-0`), поэтому клик, фокус с
 * клавиатуры и сама OAuth-проверка остаются настоящими, а цвет и подпись
 * Telegram-embed'а (он cross-origin, стилизовать нельзя) игроку не видны. Без
 * этого пара кношек различалась заливкой при одинаковых ширине, радиусе и
 * высоте.
 *
 * Ширина сообщается виджету через `data-min-width`/`data-max-width`: без них
 * embed рисует фиксированные 238 px, и слой-клик стал бы уже видимой плашки —
 * часть кнопки не нажималась бы. Высота `data-size=large` — ровно 40 px, от неё
 * и высота обеих плашек (`h-10`).
 *
 * Если скрипт виджета не загрузился (заблокирован, CSP, нет сети), прозрачного
 * слоя нет и клика тоже — показываем выключенную плашку вместо мёртвой кнопки.
 */
export function TelegramLoginWidget(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // undefined — ширину ещё не измеряли, монтировать рано; число — измерили, и
  // 0 допустим: так себя ведут jsdom и скрытый контейнер, тогда кнопка
  // остаётся в родных 238 px, но она есть.
  const [width, setWidth] = useState<number | undefined>(undefined)
  const [scriptFailed, setScriptFailed] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (el === null) {
      return
    }
    const read = (): number => Math.round(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') {
      setWidth(read())
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? read())
      // Перемонтируем только на заметное изменение: iframe мигает на каждый
      // вызов, а дробные ширины у лейаута бывают почти всегда.
      setWidth((prev) => (prev === undefined || Math.abs(prev - next) >= 2 ? next : prev))
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (container === null || width === undefined) {
      return
    }
    // Пересоздаём, а не дополняем: атрибуты читаются один раз при
    // инициализации скрипта, и без этого поворот телефона оставил бы кнопку
    // прежней ширины. Заодно это переживает двойной монтаж Strict Mode.
    container.replaceChildren()
    const widgetScript = document.createElement('script')
    widgetScript.src = 'https://telegram.org/js/telegram-widget.js?22'
    widgetScript.async = true
    widgetScript.onerror = (): void => {
      setScriptFailed(true)
    }
    widgetScript.setAttribute('data-telegram-login', TELEGRAM_BOT_NAME ?? '')
    widgetScript.setAttribute('data-auth-url', `${window.location.origin}/auth/telegram/callback`)
    widgetScript.setAttribute('data-size', 'large')
    widgetScript.setAttribute('data-userpic', 'false')
    widgetScript.setAttribute('data-radius', '12')
    if (width > 0) {
      widgetScript.setAttribute('data-min-width', String(width))
      widgetScript.setAttribute('data-max-width', String(width))
    }
    // Язык подписи закрепляем: без параметра Telegram берёт язык браузера, и у
    // части игроков кнопка была бы «Sign in with Telegram» рядом с русской
    // формой. Подпись embed'а глазами не видна, но скринридер читает её: iframe
    // живёт в DOM, а наша плашка — aria-hidden.
    widgetScript.setAttribute('data-lang', 'ru')
    container.appendChild(widgetScript)
  }, [width])

  if (scriptFailed) {
    return (
      <button type="button" className={OAUTH_BUTTON_CLASS} disabled data-testid="telegram-widget">
        <TelegramOAuthPlate />
      </button>
    )
  }

  return (
    <div
      className="group relative rounded-xl focus-within:ring-2 focus-within:ring-white/40"
      data-testid="telegram-widget"
    >
      <span
        aria-hidden
        className={`${OAUTH_BUTTON_CLASS} group-hover:bg-white/[0.07] group-focus-within:bg-white/[0.07]`}
      >
        <TelegramOAuthPlate />
      </span>
      <div
        ref={containerRef}
        data-testid="telegram-widget-slot"
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </div>
  )
}
