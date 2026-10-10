'use client'

/**
 * Telegram Mini App: мост к WebView-клиенту (GAP-21).
 *
 * Mini App — это наш же сайт, открытый внутри Telegram. Открывая его, клиент
 * кладёт параметры инициализации в URL и (или) подвешивает объект
 * `window.Telegram.WebApp`. Подписанные данные входа — строка `initData`, и
 * единственный безопасный способ её передать — отдать серверу ровно те байты,
 * которые дал клиент: подпись Telegram считается от этих строк, а любая
 * пересборка (decode → объект → JSON.stringify) меняет их и вход падает уже на
 * живом устройстве. Поэтому здесь нет URLSearchParams для `initData`: он
 * раскодируется СЕРВЕРОМ, ровно один раз, в telegram-webapp-login.use-case.
 *
 * Скрипт `telegram-web-app.js` подключается лениво и ТОЛЬКО внутри Telegram:
 * вне Telegram он не нужен (вход идёт через oauth.telegram.org), а чужой
 * скрипт на экране входа нам запрещён самим же контрактом теста
 * telegram-oauth.spec.tsx и историей с eval-колбэками (P1 #11).
 */

const TELEGRAM_WEBAPP_SCRIPT_URL = 'https://telegram.org/js/telegram-web-app.js'
/** Сколько ждём объект Telegram после вставки скрипта. */
const BRIDGE_TIMEOUT_MS = 2500
/** WebView Telegram выдаёт себя в UA; обычный браузер — нет. */
const TELEGRAM_USER_AGENT = /Telegram\/|TelegramWebview|Telegram-iOS|TelegramAndroid/i

/** Узкий срез API Telegram: только то, что мы реально вызываем. */
export interface TelegramWebAppBridge {
  /** Сырая подписанная строка. Пустая — если игрок открыт не из бота. */
  initData: string
  startParam?: string | undefined
  platform?: string | undefined
  version?: string | undefined
  /**
   * Управление самим WebView-окном. Все методы опциональны: их набор растёт от
   * версии клиента, и отсутствующий метод не имеет права ломать игру.
   */
  ready?: (() => void) | undefined
  expand?: (() => void) | undefined
  setHeaderColor?: ((color: string) => void) | undefined
  setBackgroundColor?: ((color: string) => void) | undefined
}

interface TelegramWindow {
  Telegram?: { WebApp?: TelegramWebAppBridge } | undefined
}

function bridgeOf(window: Window & TelegramWindow): TelegramWebAppBridge | undefined {
  return window.Telegram?.WebApp
}

/**
 * Один промис на загрузку: параллельные вызовы не вставляют второй скрипт.
 * Таймаут стоит на самой загрузке, а не только на чтении объекта: если скрипт
 * не дойдёт (CSP провайдера, сеть клиента, заблокированный домен), промис
 * обязан разрешиться `null`, иначе silent-вход навеки зависнет и игрок увидит
 * пустой экран вместо обычного листа входа.
 */
let bridgePromise: Promise<TelegramWebAppBridge | null> | null = null
/** Скрипт вставляется ровно один раз на документ, даже если пробуем дважды. */
let scriptRequested = false

/**
 * Возвращает объект Telegram: уже влитый клиентом — сразу, иначе вставляет их
 * скрипт (CSP `script-src … https:` его пропускает) и ждёт. `null` — мы не в
 * Mini App либо скрипт не ответил: вызывающий обязан отработать как в обычном
 * браузере.
 */
export function ensureTelegramWebAppBridge(): Promise<TelegramWebAppBridge | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null)
  }
  const scopedWindow = window as Window & TelegramWindow
  const existing = bridgeOf(scopedWindow)
  if (existing !== undefined) {
    return Promise.resolve(existing)
  }
  if (bridgePromise !== null) {
    return bridgePromise
  }
  bridgePromise = new Promise<TelegramWebAppBridge | null>((resolve): void => {
    let settled = false
    let deadline = 0
    const finish = (bridge: TelegramWebAppBridge | null): void => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(deadline)
      resolve(bridge)
    }
    deadline = window.setTimeout((): void => {
      finish(null)
    }, BRIDGE_TIMEOUT_MS)

    if (scriptRequested) {
      // Повторная попытка: скрипт уже в DOM, осталось дождаться объекта —
      // клиент может влить его позже нашего первого запроса.
      return
    }
    scriptRequested = true
    const script = document.createElement('script')
    script.src = TELEGRAM_WEBAPP_SCRIPT_URL
    script.async = true
    script.onload = (): void => {
      finish(bridgeOf(scopedWindow) ?? null)
    }
    script.onerror = (): void => {
      finish(null)
    }
    document.head.appendChild(script)
  })
  // Провал не клеймит документ: следующая попытка (смена роута, возврат
  // фокуса) должна получить шанс прочитать объект, который влился позже.
  void bridgePromise.then((bridge): void => {
    if (bridge === null) {
      bridgePromise = null
    }
  })
  return bridgePromise
}

/**
 * Параметры инициализации: Telegram кладёт их во ФРАГМЕНТ (SDK читает
 * `location.hash`), отдельные клиенты — в query. Оба места читаем, но только
 * для определения окружения и `start_param` — `initData` отсюда берётся нарочно
 * никогда (см. докблок про раскодирование).
 */
function readTelegramParams(window: Window): URLSearchParams {
  const params = new URLSearchParams(window.location.search)
  const rawHash = window.location.hash
  const fragment = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  for (const entry of fragment.split('&')) {
    const separator = entry.indexOf('=')
    if (separator > 0) {
      const key = entry.slice(0, separator)
      if (!params.has(key)) {
        params.set(key, entry.slice(separator + 1))
      }
    }
  }
  return params
}

/**
 * Мы внутри Telegram Mini App?
 *
 * Параметры `tgWebApp*` в адресе НИЧЕГО не включают: их сочиняет автор ссылки,
 * а не клиент, и «молчаливый вход по строке из URL» — это вход жертвы в чужой
 * аккаунт. Сигналы берутся те, что подделывает только сам клиент: UA WebView и
 * объект `window.Telegram`, влитый до нашей гидрации.
 */
export function detectTelegramWebApp(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  if (bridgeOf(window as Window & TelegramWindow)?.initData !== undefined) {
    return true
  }
  if (TELEGRAM_USER_AGENT.test(navigator.userAgent)) {
    return true
  }
  // Веб-клиент Telegram (K/A) держит Mini App в iframe на своём origin. Это
  // надёжный признак именно потому, что CSP `frame-ancestors` допускает сюда
  // только нас самих и telegram.org: чужая страница нас во фрейм не положит.
  return window.self !== window.top
}

/**
 * Глубокая ссылка бота (`t.me/bot/app?startapp=CODE`) — наш реферальный код.
 * Приоритет у `?ref=`, он приходит из нашей же ссылки и переживает всё.
 */
export function telegramStartParamReferral(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  const fromUrl = readTelegramParams(window).get('tgWebAppStartParam')
  const scopedWindow = window as Window & TelegramWindow
  const fromBridge = bridgeOf(scopedWindow)?.startParam
  const value = fromUrl ?? fromBridge
  return value !== undefined && value !== '' ? value : undefined
}
