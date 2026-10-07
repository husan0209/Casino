'use client'

import { apiGet, apiPost } from '@/lib/api'
import { type WebUser } from '@/stores/auth'

/**
 * OAuth-блок (pre-launch: ТЗ ч.2 UC-AUTH-08/09) — единственный на весь веб:
 * живёт внутри LoginSheet (§5), отдельные страницы входа/регистрации убраны.
 * Google: GET /auth/google/url → редирект на Google → /auth/google/callback
 *         обменивает code на сессию (state — подписанный CSRF-токен API).
 * Telegram: наша плашка ведёт на oauth.telegram.org/auth (адрес нативной кнопки
 *         виджета, но без iframe и без telegram-widget.js в странице), после
 *         подтверждения Telegram возвращает на /auth/telegram/callback с
 *         результатом в #tgAuthResult. Там подпись сверяется (POST
 *         /auth/telegram/preview, сессию не выдаёт), игрок видит, под каким
 *         аккаунтом идёт вход, и только по «Продолжить» меняется данные на
 *         сессию (POST /auth/telegram). Работает только на домене, добавленном
 *         боту через /setdomain, — на остальных Telegram показывает ошибку.
 *
 * Каждая кнопка рисует реальный поток только когда задана её NEXT_PUBLIC-
 * переменная — «подключается при наличии ключей». Реферальный код (§5.1: из
 * ?ref= — тихо) передаётся в оба потока.
 */

export const GOOGLE_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID']

export const TELEGRAM_BOT_NAME = process.env['NEXT_PUBLIC_TELEGRAM_BOT_NAME']

/**
 * Числовой id бота — префикс токена до двоеточия. Публичен (его видит браузер в
 * URL авторизации), но задаётся отдельно: токен живёт только на сервере и в
 * фронт не попадает никогда.
 *
 * Пустая строка = «не настроено»: ключ существует и в `.env.example`, и в
 * build-args compose (`${NEXT_PUBLIC_TELEGRAM_BOT_ID:-}`), поэтому наивное
 * `!== undefined` выпустило бы кнопку, ведущую на `/auth?bot_id=`.
 */
export const TELEGRAM_BOT_ID = process.env['NEXT_PUBLIC_TELEGRAM_BOT_ID'] || undefined

/**
 * Единый стиль OAuth-плашек листа (Google/Telegram).
 *
 * Высота задана явно (`h-10` = 40 px), а не подушкой `py-*`: с `py-3` плашка
 * выходила 46 px, и столбец кнопок «дышал» относительно полей формы той же
 * шторки. Обе кнопки теперь наши, поэтому размер выбран у нас, а не у iframe.
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
 * Ответы API лежат в конверте {success,data}, и apiPost отдаёт его внутренность.
 * Если конверт потерялся (прокси вернул 200 с пустым телом, другой контракт),
 * внутри undefined, и экран входа падал в «Что-то сломалось» на первом же
 * чтении поля. Форма проверяется здесь: игрок получает внятную ошибку вместо
 * crash-границы, и никто не видит «создадим новый аккаунт» там, где ответа нет.
 */
function expectData<T>(value: T | undefined, endpoint: string): T {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${endpoint} вернул неожиданный ответ`)
  }
  return value
}

/**
 * Обмен данных виджета на сессию — POST /auth/telegram. Подпись Telegram
 * проверяет API по HMAC от TELEGRAM_BOT_TOKEN (токен живёт только на сервере).
 */
export async function exchangeTelegramAuth(
  payload: TelegramAuthPayload,
  referralCode?: string,
): Promise<{ accessToken: string; user: WebUser }> {
  const res = await apiPost<{ accessToken: string; user: WebUser } | undefined>('/auth/telegram', {
    ...telegramDtoBody(payload),
    referral_code: referralCode,
  })
  return expectData(res, 'POST /auth/telegram')
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
  const res = await apiPost<TelegramPreviewResult | undefined>(
    '/auth/telegram/preview',
    telegramDtoBody(payload),
  )
  const preview = expectData(res, 'POST /auth/telegram/preview')
  if (typeof preview.accountExists !== 'boolean') {
    throw new Error('POST /auth/telegram/preview вернул неожиданный ответ')
  }
  return preview
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
 * Куда Telegram возвращает игрока после подтверждения. Тихий `?ref=` обязан
 * уехать внутри этого адреса: и страница авторизации, и виджет наклеивают
 * результат на РОВНО переданный URL, query исходной страницы не переносится —
 * без ref регистрация через Telegram создавала бы игрока без реферера.
 */
function telegramCallbackUrl(referralCode?: string): string {
  const url = `${window.location.origin}/auth/telegram/callback`
  return referralCode ? `${url}?ref=${encodeURIComponent(referralCode)}` : url
}

/**
 * Ссылка авторизации Telegram — тот же адрес, который открывает нативная кнопка
 * виджета (`TWidgetLogin.auth`), только для перехода в этой же вкладке.
 * `null`, если id бота не настроен: уходить на `/auth?bot_id=undefined` хуже,
 * чем не нажимать кнопку.
 *
 * `request_access` не просим: для входа достаточно подписи пользователя,
 * write-доступ — лишние права, отданные боту.
 */
export function telegramAuthorizeUrl(referralCode?: string): string | null {
  if (TELEGRAM_BOT_ID === undefined) {
    return null
  }
  const params = new URLSearchParams({
    bot_id: TELEGRAM_BOT_ID,
    origin: window.location.origin,
    lang: 'ru',
    return_to: telegramCallbackUrl(referralCode),
  })
  return `https://oauth.telegram.org/auth?${params.toString()}`
}

/**
 * Вход через Telegram (UC-AUTH-09) без виджета: уходим на
 * oauth.telegram.org/auth, Telegram возвращает на return_to с результатом в
 * #tgAuthResult.
 *
 * Отказ от скрипта осознанный и решает три вещи сразу:
 * - iframe виджета кросс-доменный, его кнопку нельзя перекрасить, и в паре с
 *   Google-плашкой Telegram всегда оставался чужим по заливе и надписи;
 * - строковый колбэк `data-onauth` виджет собирает через `Function('user', …)`,
 *   то есть eval, запрещённый прод-CSP (P1 #11 ронял виджет на EvalError);
 * - из страницы уходит third-party скрипт и с ним исключение telegram.org в
 *   `script-src`.
 */
export function startTelegramOAuth(referralCode?: string): void {
  const url = telegramAuthorizeUrl(referralCode)
  if (url !== null) {
    window.location.assign(url)
  }
}

/**
 * Данные пользователя из `#tgAuthResult`: Telegram возвращает результат в хэше
 * того самого `return_to` — base64url от JSON. Формат разбиваем так же, как
 * официальный telegram-widget.js (`haveTgAuthResult`: та же регулярка и тот же
 * паддинг), но декодируем в UTF-8 — см. комментарий внутри.
 *
 * Полям отсюда не верим в принципе: подпись перепроверяет API (POST
 * /auth/telegram), а экран показывает только то, что он подтвердит.
 */
export function telegramPayloadFromHash(): TelegramAuthPayload | null {
  const match = /[#?&]tgAuthResult=([A-Za-z0-9\-_=]*)/.exec(window.location.hash)
  if (match === null) {
    return null
  }
  try {
    let data = (match[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const pad = data.length % 4
    if (pad > 1) {
      data += '='.repeat(4 - pad)
    }
    // upstream-виджет делает просто JSON.parse(window.atob(...)). Это работает,
    // пока Telegram экранирует не-ASCII в JSON (\u0418), но имя «Иван» байтами
    // UTF-8 превращается в mojibake — и он уехал бы обратно в API, где подпись
    // считается в том числе по first_name, то есть вход отбился бы
    // «подпись Telegram не совпадает». TextDecoder переваривает и то, и другое.
    const bytes = Uint8Array.from(window.atob(data), (ch) => ch.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes))
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const candidate = parsed as Record<string, unknown>
    const id = candidate['id']
    const authDate = candidate['auth_date']
    const hash = candidate['hash']
    if (
      (typeof id !== 'number' && typeof id !== 'string') ||
      (typeof authDate !== 'number' && typeof authDate !== 'string') ||
      typeof hash !== 'string'
    ) {
      return null
    }
    const pick = (key: string): string | undefined => {
      const value = candidate[key]
      return typeof value === 'string' ? value : undefined
    }
    const firstName = pick('first_name')
    const lastName = pick('last_name')
    const username = pick('username')
    const photoUrl = pick('photo_url')
    return {
      id,
      auth_date: authDate,
      hash,
      ...(firstName !== undefined && { first_name: firstName }),
      ...(lastName !== undefined && { last_name: lastName }),
      ...(username !== undefined && { username }),
      ...(photoUrl !== undefined && { photo_url: photoUrl }),
    }
  } catch {
    // Мусор в хэше — это «данных нет», а не падение страницы.
    return null
  }
}

/**
 * Плашка Telegram: тот же класс, что у Google, и та же формулировка шага —
 * «Продолжить с …». Кнопка настоящая (не iframe), поэтому стиль наш целиком.
 */
export function TelegramOAuthPlate(): React.JSX.Element {
  return (
    <>
      <TelegramMark size={20} />
      Продолжить с Telegram
    </>
  )
}
