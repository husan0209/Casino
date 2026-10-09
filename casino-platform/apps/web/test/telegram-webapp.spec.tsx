import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Telegram Mini App на клиенте (GAP-21): silent-вход по подписанному initData.
 *
 * Что здесь принципиально:
 * - `init_data` уходит на сервер В ТОЧНОМ виде, как его отдал клиент: никакие
 *   URLSearchParams/JSON-пересборки не разрешены — подпись считается от этих
 *   байт, и перекодировка убивает вход только на живом устройстве;
 * - чужой скрипт `telegram.org/js/telegram-web-app.js` появляется ТОЛЬКО внутри
 *   Telegram, поэтому обычный браузер по-прежнему не тянет ни одного стороннего
 *   скрипта (тот же инвариант, что закрепил telegram-oauth.spec.tsx);
 * - один handshake на документ: StrictMode монтирует эффект дважды, и без
 *   общей промисы игрок получал бы две сессии;
 * - отказ сервера не оставляет реквизиты входа в адресной строке.
 */

const api = vi.hoisted(() => ({ apiPost: vi.fn(), setAccessToken: vi.fn() }))
const storeState = vi.hoisted(() => ({
  token: null as string | null,
  user: null as { id: string; email: string | null; role: string } | null,
  setSession: vi.fn(),
}))

vi.mock('@/lib/api', () => api)
vi.mock('@/stores/auth', () => ({
  useAuthStore: { getState: () => storeState },
}))

import {
  detectTelegramWebApp,
  ensureTelegramWebAppBridge,
  telegramStartParamReferral,
} from '@/lib/telegram-webapp'
import { handshakeTelegramWebApp } from '@/lib/telegram-webapp-auth'

interface TelegramWindow {
  Telegram?: { WebApp?: { initData: string; startParam?: string } }
}

/**
 * Ровно та форма, в которой Telegram отдаёт initData: значения percent-encoded,
 * вложенный `user` — JSON-строкой внутри.
 */
const RAW_INIT_DATA =
  'query_id=AAHdF6IQAAAAAN0XohDn59tB' +
  '&user=%7B%22id%22%3A45367%2C%22first_name%22%3A%22%D0%98%D0%B2%D0%B0%D0%BD%22%7D' +
  '&auth_date=1700000000&hash=af1c2e5b90d34a6c8e2f1b7d5a3c9e0f2b4d6a8c0e1f3a5b7c9d1e3f5a7b9c1d'

function installBridge(initData: string = RAW_INIT_DATA, startParam?: string): void {
  const scopedWindow = window as Window & TelegramWindow
  scopedWindow.Telegram =
    startParam === undefined ? { WebApp: { initData } } : { WebApp: { initData, startParam } }
}

function removeBridge(): void {
  delete (window as Window & TelegramWindow).Telegram
}

function okSession(): { accessToken: string; user: { id: string; email: null; role: string } } {
  return { accessToken: 'tg-token', user: { id: 'u1', email: null, role: 'user' } }
}

beforeEach(() => {
  api.apiPost.mockReset()
  api.setAccessToken.mockReset()
  storeState.setSession.mockReset()
  storeState.token = null
  storeState.user = null
  removeBridge()
})

afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('detectTelegramWebApp', () => {
  it('обычный браузер — не Mini App', () => {
    expect(detectTelegramWebApp()).toBe(false)
  })

  it('параметры в fragment и в query считаются одинаково', () => {
    window.history.replaceState(null, '', '/#tgWebAppVersion=6.3&tgWebAppPlatform=android')
    expect(detectTelegramWebApp()).toBe(true)

    window.history.replaceState(null, '', '/?tgWebAppPlatform=weba')
    expect(detectTelegramWebApp()).toBe(true)
  })

  it('клиент мог влить window.Telegram сам, без параметров в URL', () => {
    installBridge()
    expect(detectTelegramWebApp()).toBe(true)
  })

  it('start_param deep-link даёт реферальный код, ?ref= не обязателен', () => {
    window.history.replaceState(null, '', '/?tgWebAppStartParam=REF9')
    expect(telegramStartParamReferral()).toBe('REF9')
  })

  it('пустой start_param — это не реферал', () => {
    window.history.replaceState(null, '', '/#tgWebAppStartParam=')
    expect(telegramStartParamReferral()).toBeUndefined()
  })
})

describe('handshakeTelegramWebApp', () => {
  it('вне Telegram: ни запроса, ни стороннего скрипта', async () => {
    await expect(handshakeTelegramWebApp()).resolves.toBe(false)

    expect(api.apiPost).not.toHaveBeenCalled()
    expect(document.querySelector('script[src*="telegram.org"]')).toBeNull()
  })

  it('сырая initData уходит байт-в-байт, сессию берём из ответа API', async () => {
    installBridge()
    api.apiPost.mockResolvedValue(okSession())

    await expect(handshakeTelegramWebApp()).resolves.toBe(true)

    expect(api.apiPost).toHaveBeenCalledWith('/auth/telegram/webapp', {
      init_data: RAW_INIT_DATA,
    })
    expect(api.setAccessToken).toHaveBeenCalledWith('tg-token')
    expect(storeState.setSession).toHaveBeenCalledWith('tg-token', {
      id: 'u1',
      email: null,
      role: 'user',
    })
  })

  /**
   * Реферал игрока — смысл партнёрской программы: ссылка бота несёт код в
   * start_param, наш `?ref=` приоритетнее, потому что приходит из нашей же
   * ссылки.
   */
  it('тихий ?ref= важнее start_param, старт-код без ref подхватывается', async () => {
    installBridge(RAW_INIT_DATA, 'STARTCODE')
    window.history.replaceState(null, '', '/?ref=REFCODE')
    api.apiPost.mockResolvedValue(okSession())

    await handshakeTelegramWebApp()
    expect(api.apiPost.mock.calls[0]![1]).toMatchObject({ referral_code: 'REFCODE' })

    window.history.replaceState(null, '', '/')
    api.apiPost.mockClear()
    await handshakeTelegramWebApp()
    expect(api.apiPost.mock.calls[0]![1]).toMatchObject({ referral_code: 'STARTCODE' })
  })

  it('живая сессия уже есть — второго входа не будет', async () => {
    installBridge()
    storeState.token = 'living-token'

    await expect(handshakeTelegramWebApp()).resolves.toBe(false)
    expect(api.apiPost).not.toHaveBeenCalled()
  })

  it('один handshake на документ, даже если эффект смонтирован дважды', async () => {
    installBridge()
    let release: ((value: ReturnType<typeof okSession>) => void) | undefined
    api.apiPost.mockReturnValue(
      new Promise((resolve): void => {
        release = resolve
      }),
    )

    const first = handshakeTelegramWebApp()
    const second = handshakeTelegramWebApp()
    release?.(okSession())

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(api.apiPost).toHaveBeenCalledTimes(1)
  })

  it('сервер отказал: входа нет, но реквизиты из адреса выметены', async () => {
    installBridge()
    window.history.replaceState(null, '', '/?tgWebAppVersion=6.3&ref=REF9#anchor')
    api.apiPost.mockRejectedValue(new Error('подпись Telegram не совпадает'))

    await expect(handshakeTelegramWebApp()).resolves.toBe(false)

    expect(storeState.setSession).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?ref=REF9')
    expect(window.location.hash).toBe('#anchor')
  })

  it('tgWebApp* в fragment выметается целиком, путь страницы остаётся', async () => {
    installBridge()
    window.history.replaceState(null, '', '/casino/slot-x?ref=REF9#tgWebAppData=x&tgWebAppV=6.3')
    api.apiPost.mockResolvedValue(okSession())

    await expect(handshakeTelegramWebApp()).resolves.toBe(true)
    expect(window.location.pathname).toBe('/casino/slot-x')
    expect(window.location.search).toBe('?ref=REF9')
    expect(window.location.hash).toBe('')
  })

  /**
   * Последний кейс: он уходит в ветку вставки скрипта и оставляет после себя
   * разрешённый промис моста, поэтому порядок в файле важен.
   */
  it('клиент не влил Telegram сам: скрипт вставляется один раз и таймаут не вешает вход', async () => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/?tgWebAppVersion=6.3')

    const pending = Promise.all([ensureTelegramWebAppBridge(), ensureTelegramWebAppBridge()])
    await vi.advanceTimersByTimeAsync(3_000)

    await expect(pending).resolves.toEqual([null, null])
    expect(document.querySelectorAll('script[src*="telegram.org"]')).toHaveLength(1)

    api.apiPost.mockResolvedValue(okSession())
    await expect(handshakeTelegramWebApp()).resolves.toBe(false)
    expect(api.apiPost).not.toHaveBeenCalled()
  })
})
