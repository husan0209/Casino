import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Telegram Mini App на клиенте (GAP-75): silent-вход по подписанному initData.
 *
 * Что здесь принципиально:
 * - вход НЕ включается от параметров в адресе: `tgWebApp*` сочиняет автор
 *   ссылки, и «молчаливый вход по строке из URL» = вход жертвы в чужой аккаунт;
 * - `init_data` уходит на сервер В ТОЧНОМ виде, как её отдал клиент: никакие
 *   URLSearchParams/JSON-пересборки не разрешены — подпись считается от этих
 *   байт;
 * - чужой скрипт telegram.org появляется ТОЛЬКО внутри Telegram (обычный
 *   браузер не тянет ничего стороннего — тот же инвариант, что в
 *   telegram-oauth.spec.tsx);
 * - один handshake на документ: StrictMode монтирует эффект дважды;
 * - реквизиты выметаются из адреса при любом исходе.
 *
 * Модули импортируются заново в каждом кейсе: `bridgePromise` и
 * `handshakePromise` живут на уровне модуля, и без resetModules тесты становятся
 * зависимыми от порядка (подтверждено: --sequence.shuffle падал).
 */

const api = vi.hoisted(() => ({ apiPost: vi.fn(), setAccessToken: vi.fn() }))
const storeState = vi.hoisted(() => ({
  token: null as string | null,
  user: null as { id: string; email: string | null; role: string } | null,
  setSession: vi.fn(),
}))

vi.mock('@/lib/api', () => api)
vi.mock('@/stores/auth', () => ({ useAuthStore: { getState: () => storeState } }))

interface TelegramWindow {
  Telegram?: { WebApp?: { initData: string; startParam?: string } }
}

/** Ровно та форма, в которой Telegram отдаёт initData. */
const RAW_INIT_DATA =
  'query_id=AAHdF6IQAAAAAN0XohDn59tB' +
  '&user=%7B%22id%22%3A45367%2C%22first_name%22%3A%22%D0%98%D0%B2%D0%B0%D0%BD%22%7D' +
  '&auth_date=1700000000&hash=af1c2e5b90d34a6c8e2f1b7d5a3c9e0f2b4d6a8c0e1f3a5b7c9d1e3f5a7b9c1d'

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
const TELEGRAM_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120 Mobile Safari/537.36 Telegram/Android'

interface MiniAppModules {
  detectTelegramWebApp: () => boolean
  ensureTelegramWebAppBridge: () => Promise<unknown>
  telegramStartParamReferral: () => string | undefined
  handshakeTelegramWebApp: () => Promise<boolean>
}

async function loadModules(): Promise<MiniAppModules> {
  vi.resetModules()
  const bridge = await import('@/lib/telegram-webapp')
  const auth = await import('@/lib/telegram-webapp-auth')
  return {
    detectTelegramWebApp: bridge.detectTelegramWebApp,
    ensureTelegramWebAppBridge: bridge.ensureTelegramWebAppBridge,
    telegramStartParamReferral: bridge.telegramStartParamReferral,
    handshakeTelegramWebApp: auth.handshakeTelegramWebApp,
  }
}

function setUserAgent(value: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true })
}

function installBridge(initData: string = RAW_INIT_DATA, startParam?: string): void {
  const scopedWindow = window as Window & TelegramWindow
  scopedWindow.Telegram =
    startParam === undefined ? { WebApp: { initData } } : { WebApp: { initData, startParam } }
}

function removeBridge(): void {
  delete (window as Window & TelegramWindow).Telegram
}

function dropTelegramScripts(): void {
  for (const node of document.querySelectorAll('script[src*="telegram.org"]')) {
    node.remove()
  }
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
  dropTelegramScripts()
  setUserAgent(BROWSER_UA)
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.useRealTimers()
  dropTelegramScripts()
  removeBridge()
  window.history.replaceState(null, '', '/')
})

describe('detectTelegramWebApp', () => {
  it('обычный браузер — не Mini App', async () => {
    const { detectTelegramWebApp } = await loadModules()
    expect(detectTelegramWebApp()).toBe(false)
  })

  it('WebView Telegram узнаётся по UA клиента', async () => {
    setUserAgent(TELEGRAM_UA)
    const { detectTelegramWebApp } = await loadModules()
    expect(detectTelegramWebApp()).toBe(true)
  })

  it('клиент мог влить window.Telegram сам, без UA', async () => {
    installBridge()
    const { detectTelegramWebApp } = await loadModules()
    expect(detectTelegramWebApp()).toBe(true)
  })

  /**
   * Регресс CSRF-вектора: ссылка `…/?tgWebAppData=<чужая подпись>` открытая в
   * обычном браузере не имеет права ни логинить, ни тянуть сторонний скрипт.
   */
  it('параметры в адресе сами по себе вход не включают', async () => {
    window.history.replaceState(
      null,
      '',
      '/?tgWebAppVersion=7.7&tgWebAppData=x#tgWebAppPlatform=weba',
    )
    const { detectTelegramWebApp } = await loadModules()
    expect(detectTelegramWebApp()).toBe(false)
  })

  it('start_param deep-link даёт реферальный код', async () => {
    window.history.replaceState(null, '', '/?tgWebAppStartParam=REF9')
    const { telegramStartParamReferral } = await loadModules()
    expect(telegramStartParamReferral()).toBe('REF9')
  })

  it('пустой start_param — это не реферал', async () => {
    window.history.replaceState(null, '', '/#tgWebAppStartParam=')
    const { telegramStartParamReferral } = await loadModules()
    expect(telegramStartParamReferral()).toBeUndefined()
  })
})

describe('handshakeTelegramWebApp', () => {
  it('вне Telegram: ни запроса, ни стороннего скрипта, и приманка из адреса выметена', async () => {
    window.history.replaceState(null, '', '/profile?tgWebAppData=x&ref=REF9')
    const { handshakeTelegramWebApp } = await loadModules()

    await expect(handshakeTelegramWebApp()).resolves.toBe(false)

    expect(api.apiPost).not.toHaveBeenCalled()
    expect(document.querySelector('script[src*="telegram.org"]')).toBeNull()
    expect(window.location.search).toBe('?ref=REF9')
  })

  it('сырая initData уходит байт-в-байт, сессию берём из ответа API', async () => {
    installBridge()
    api.apiPost.mockResolvedValue(okSession())
    const { handshakeTelegramWebApp } = await loadModules()

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

  it('тихий ?ref= важнее start_param, без ref подхватывается start_param', async () => {
    installBridge(RAW_INIT_DATA, 'STARTCODE')
    window.history.replaceState(null, '', '/?ref=REFCODE')
    api.apiPost.mockResolvedValue(okSession())
    const { handshakeTelegramWebApp } = await loadModules()

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
    const { handshakeTelegramWebApp } = await loadModules()

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
    const { handshakeTelegramWebApp } = await loadModules()

    const first = handshakeTelegramWebApp()
    const second = handshakeTelegramWebApp()
    release?.(okSession())

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(api.apiPost).toHaveBeenCalledTimes(1)
  })

  it('сервер отказал: входа нет, но реквизиты из адреса выметены', async () => {
    installBridge()
    window.history.replaceState(null, '', '/?tgWebAppVersion=7.7&ref=REF9#anchor')
    api.apiPost.mockRejectedValue(new Error('подпись Telegram не совпадает'))
    const { handshakeTelegramWebApp } = await loadModules()

    await expect(handshakeTelegramWebApp()).resolves.toBe(false)

    expect(storeState.setSession).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?ref=REF9')
    expect(window.location.hash).toBe('#anchor')
  })

  it('tgWebApp* во фрагменте выметаются целиком, путь и якорь остаются', async () => {
    installBridge()
    window.history.replaceState(null, '', '/casino/slot-x?ref=REF9#tgWebAppData=x&tgWebAppV=7.7')
    api.apiPost.mockResolvedValue(okSession())
    const { handshakeTelegramWebApp } = await loadModules()

    await expect(handshakeTelegramWebApp()).resolves.toBe(true)
    expect(window.location.pathname).toBe('/casino/slot-x')
    expect(window.location.search).toBe('?ref=REF9')
    expect(window.location.hash).toBe('')
  })

  it('клиент не влил Telegram сам: скрипт вставляется один раз, таймаут не вешает вход', async () => {
    vi.useFakeTimers()
    setUserAgent(TELEGRAM_UA)
    const { ensureTelegramWebAppBridge, handshakeTelegramWebApp } = await loadModules()

    const pending = Promise.all([ensureTelegramWebAppBridge(), ensureTelegramWebAppBridge()])
    await vi.advanceTimersByTimeAsync(3_000)
    await expect(pending).resolves.toEqual([null, null])
    expect(document.querySelectorAll('script[src*="telegram.org"]')).toHaveLength(1)

    // Провал не клеймит документ: вторая попытка читает объект, если он влился
    // позже, и не добавляет второй скрипт.
    installBridge()
    api.apiPost.mockResolvedValue(okSession())
    await expect(handshakeTelegramWebApp()).resolves.toBe(true)
    expect(document.querySelectorAll('script[src*="telegram.org"]')).toHaveLength(1)
    expect(api.apiPost).toHaveBeenCalledTimes(1)
  })
})
