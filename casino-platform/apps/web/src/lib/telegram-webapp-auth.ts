'use client'

import { apiPost, setAccessToken } from '@/lib/api'
import {
  detectTelegramWebApp,
  ensureTelegramWebAppBridge,
  telegramStartParamReferral,
} from '@/lib/telegram-webapp'
import { type WebUser, useAuthStore } from '@/stores/auth'

/**
 * Silent-вход из Telegram Mini App (GAP-21).
 *
 * Игрок открыл приложение из чата с ботом — он уже подтвердил действие самим
 * клиентом Telegram, поэтому отдельного экрана «Продолжить как …» здесь нет
 * (он нужен редиректному входу через oauth.telegram.org, где подтверждение
 * приходит страницей обратно). Мы отдаём серверу сырую `initData`, сервер
 * проверяет подпись и выдаёт сессию тем же путём, что и OAuth-вход: аккаунт
 * находится по связке `auth_providers(telegram, <tg id>)`, поэтому Mini App и
 * вход через кнопку на сайте — один и тот же игрок.
 *
 * Ошибка любая = обычный сайт: показываем лист входа, ничего не ломаем тостом.
 * Молчание осознанное: 401 здесь означает «этот путь не сработал», а не «сбой
 * сайта», и повторить вход игрок может вручную.
 */

/** Один handshake на жизнь документа: параллельные монти не плодят сессии. */
let handshakePromise: Promise<boolean> | null = null

/**
 * Выметаем реквизиты входа из адреса. `initData` — готовый токен с суточным
 * TTL: оставшись в адресной строке, он попадает в историю и в реферер-заголовки
 * сторонних картинок. Обычные query-параметры страницы (`?ref=`, `?url=`) не
 * трогаем.
 */
function cleanTelegramInitParams(): void {
  const search = new URLSearchParams(window.location.search)
  const rawFragment = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const fragmentEntries = rawFragment.split('&').filter((entry): boolean => entry !== '')
  const keptFragment = fragmentEntries.filter((entry): boolean => !entry.startsWith('tgWebApp'))

  let changed = keptFragment.length !== fragmentEntries.length
  for (const key of [...search.keys()]) {
    if (key.startsWith('tgWebApp')) {
      search.delete(key)
      changed = true
    }
  }
  if (!changed) {
    return
  }

  const query = search.toString()
  const hash = keptFragment.join('&')
  const target = `${window.location.pathname}${query === '' ? '' : `?${query}`}${
    hash === '' ? '' : `#${hash}`
  }`
  window.history.replaceState(null, '', target)
}

async function runHandshake(): Promise<boolean> {
  if (!detectTelegramWebApp()) {
    return false
  }
  const state = useAuthStore.getState()
  // Рабочая сессия уже есть (гидрация по cookie успела раньше) — перелогиниваться
  // незачем: это второй POST на каждый mount и вторая строка в `sessions`.
  if (state.token !== null || state.user !== null) {
    return false
  }

  const bridge = await ensureTelegramWebAppBridge()
  const initData = bridge?.initData ?? ''
  if (initData === '') {
    return false
  }

  const referralFromUrl = new URLSearchParams(window.location.search).get('ref')
  const referralCode =
    referralFromUrl !== null && referralFromUrl !== ''
      ? referralFromUrl
      : telegramStartParamReferral()

  // Реквизиты выметаются ДО запроса, а не после успеха: отказ сервера не должен
  // оставлять подписанный initData в адресной строке и в истории.
  cleanTelegramInitParams()

  try {
    const result = await apiPost<{ accessToken: string; user: WebUser }>('/auth/telegram/webapp', {
      init_data: initData,
      ...(referralCode !== undefined ? { referral_code: referralCode } : {}),
    })
    setAccessToken(result.accessToken)
    // setSession перечитывает гейт повторного акцепта оферты (stores/auth):
    // silent-вход не должен обходить 18+ подтверждение новой редакции.
    useAuthStore.getState().setSession(result.accessToken, result.user)
    return true
  } catch {
    return false
  }
}

/**
 * Пробует войти по initData. `true` — сессия в сторе; `false` — не Mini App,
 * нет подписи или сервер отказал (caller обязан продолжить со `hydrate()`).
 * Single-flight: React StrictMode монтирует эффект дважды, и без общей промисы
 * мы получили бы два входа и две сессии в БД.
 */
export function handshakeTelegramWebApp(): Promise<boolean> {
  if (handshakePromise !== null) {
    return handshakePromise
  }
  handshakePromise = runHandshake().finally((): void => {
    handshakePromise = null
  })
  return handshakePromise
}
