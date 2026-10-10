'use client'

import { apiPost, setAccessToken } from '@/lib/api'
import {
  detectTelegramWebApp,
  ensureTelegramWebAppBridge,
  telegramStartParamReferral,
} from '@/lib/telegram-webapp'
import { type WebUser, useAuthStore } from '@/stores/auth'

/**
 * Silent-вход из Telegram Mini App (GAP-75).
 *
 * Игрок открыл приложение из чата с ботом — сам факт открытия уже его
 * подтверждает, поэтому экрана «Продолжить как …» здесь нет (он нужен
 * редиректному входу через oauth.telegram.org). Мы отдаём серверу сырую
 * `initData`, сервер проверяет подпись и выдаёт сессию тем же путём, что и
 * OAuth-вход: аккаунт ищется по связке `auth_providers(telegram, <tg id>)`,
 * поэтому Mini App и кнопка на сайте — один и тот же игрок.
 *
 * Чего здесь сознательно нет:
 * - чтения initData из URL: параметры в адресе сочиняет автор ссылки, а не
 *   клиент, и «войти по строке из query» означало бы вход жертвы в чужой
 *   аккаунт. Берём строку только у объекта клиента (lib/telegram-webapp.ts);
 * - молчаливой регистрации: новый аккаунт заводится через экран подтверждения
 *   виджета, где видно имя.
 *
 * Любая ошибка = обычный сайт: показываем лист входа, тоста нет — 401 здесь
 * значит «этот путь не сработал», а не «сайт сломался».
 */

/** Один handshake на документ: параллельные монти не плодят сессии. */
let handshakePromise: Promise<boolean> | null = null

/**
 * Выметаем реквизиты входа из адреса. `init_data` — предъявительский токен:
 * оставшись в адресной строке, он попадает в историю и в реферер-заголовки
 * сторонних картинок. Обычные query-параметры страницы (`?ref=`, `?url=`) и
 * чужие фрагменты (`#anchor`) не трогаем.
 */
function stripTelegramInitParams(): void {
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
  // null вместо history state: Next перечитывает своё состояние из URL, терять
  // его нечем — страница остаётся той же.
  window.history.replaceState(null, '', target)
}

async function runHandshake(): Promise<boolean> {
  const referralFromUrl = new URLSearchParams(window.location.search).get('ref')
  // start_param читаем ДО очистки: это параметр запуска, а не реквизит входа.
  const startParam = telegramStartParamReferral()

  if (!detectTelegramWebApp()) {
    // Обычный браузер по ссылке с подставленными tgWebApp*: вход не делаем, но
    // и приманку в адресе не оставляем.
    stripTelegramInitParams()
    return false
  }

  const state = useAuthStore.getState()
  if (state.token !== null || state.user !== null) {
    // Рабочая сессия есть — второй вход не нужен, реквизиты выметаем.
    stripTelegramInitParams()
    return false
  }

  // Скрипт клиента читает параметры запуска из URL сам, поэтому чистим адрес
  // только ПОСЛЕ того, как объект Telegram получен и строка прочитана.
  const bridge = await ensureTelegramWebAppBridge()
  const initData = bridge?.initData ?? ''
  stripTelegramInitParams()
  if (initData === '') {
    return false
  }

  const referralCode =
    referralFromUrl !== null && referralFromUrl !== '' ? referralFromUrl : startParam

  try {
    const result = await apiPost<{ accessToken: string; user: WebUser }>('/auth/telegram/webapp', {
      init_data: initData,
      ...(referralCode !== undefined ? { referral_code: referralCode } : {}),
    })
    setAccessToken(result.accessToken)
    // setSession перечитывает гейт повторного акцепта оферты (stores/auth):
    // silent-вход не обходит 18+ подтверждение новой редакции.
    useAuthStore.getState().setSession(result.accessToken, result.user)
    return true
  } catch {
    return false
  }
}

/**
 * Пробует войти по initData. `true` — сессия в сторе; `false` — не Mini App, нет
 * подписи или сервер отказал (caller обязан продолжить со `hydrate()`).
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
