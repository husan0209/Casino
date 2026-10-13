import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Google One Tap на клиенте: карточка «Продолжить как …» от Google (её рисует
 * браузер через FedCM, не страница).
 *
 * Что здесь принципиально:
 * - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` читается на импорт модуля, а `loadPending` и
 *   `inFlight` живут на уровне модуля — каждый кейс получает свежий модуль
 *   (vi.resetModules + vi.stubEnv), иначе результаты зависели бы от порядка;
 * - залогиненному подсказки нет: вторая сессия в углу работающей — это приглашение
 *   перепутать кошельки;
 * - gsi-скрипт — ровно один тег на попытку, провал (onerror/таймаут 5 с) не
 *   кешируется и не оставляет ни nonce-запроса, ни подсказки;
 * - credential обменивается тихо: при любой ошибке `false`, без токена, без
 *   сессии и без тоста (провал One Tap не имеет права кричать тому, кто идёт
 *   по паролю).
 */

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), setAccessToken: vi.fn() }))

const storeState = vi.hoisted(() => ({
  token: null as string | null,
  user: null as WebUserFixture | null,
  setSession: vi.fn(),
}))

vi.mock('@/lib/api', () => api)
vi.mock('@/stores/auth', () => ({ useAuthStore: { getState: () => storeState } }))

const CLIENT_ID = 'casino-client-id.apps.googleusercontent.test'
const GSI_SRC = 'https://accounts.google.com/gsi/client'
const CREDENTIAL = 'one-tap-credential-fixture-0123456789abcdef'

interface WebUserFixture {
  id: string
  email: string | null
  role: string
}

interface CredentialResponseFixture {
  credential?: string
}

interface InitializeConfigFixture {
  client_id: string
  nonce: string
  auto_select: boolean
  cancel_on_tap_outside: boolean
  callback: (response: CredentialResponseFixture) => void
}

interface PromptNotificationFixture {
  isNotDisplayed: () => boolean
  isSkippedMoment: () => boolean
  isDismissedMoment: () => boolean
}

type PromptNotifier = (notification: PromptNotificationFixture) => void

interface GoogleIdSpy {
  initialize: (config: InitializeConfigFixture) => void
  prompt: (notifier?: PromptNotifier) => void
  configs: InitializeConfigFixture[]
  notifiers: PromptNotifier[]
}

interface GoogleWindow {
  google?: { accounts?: { id?: GoogleIdSpy } }
}

interface OneTapModules {
  startGoogleOneTap: () => Promise<boolean>
  loadGoogleGsiScript: () => Promise<boolean>
}

interface OneTapAttempt {
  google: GoogleIdSpy
  config: InitializeConfigFixture
  pending: Promise<boolean>
}

interface ReferralCase {
  search: string
  body: { credential: string; referral_code?: string }
}

const GUEST_USER: WebUserFixture = { id: 'u1', email: 'player@gmail.test', role: 'user' }

function okSession(): { accessToken: string; user: WebUserFixture } {
  return { accessToken: 'ga-token', user: GUEST_USER }
}

function createGoogleIdSpy(): GoogleIdSpy {
  const configs: InitializeConfigFixture[] = []
  const notifiers: PromptNotifier[] = []
  return {
    initialize: vi.fn((config: InitializeConfigFixture): void => {
      configs.push(config)
    }),
    prompt: vi.fn((notifier?: PromptNotifier): void => {
      if (notifier !== undefined) {
        notifiers.push(notifier)
      }
    }),
    configs,
    notifiers,
  }
}

/** gsi-объект Google уже в документе: загрузка скрипта модулю не нужна. */
function installGoogleIdSpy(): GoogleIdSpy {
  const spy = createGoogleIdSpy()
  ;(window as Window & GoogleWindow).google = { accounts: { id: spy } }
  return spy
}

function removeGoogle(): void {
  delete (window as Window & GoogleWindow).google
}

function gsiScriptTags(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>(`script[src="${GSI_SRC}"]`)]
}

function dropGsiScripts(): void {
  for (const node of gsiScriptTags()) {
    node.remove()
  }
}

/** jsdom чужие скрипты не исполняет — исход события подставляем вручную. */
function fireGsiScript(event: 'load' | 'error', index = 0): void {
  const script = gsiScriptTags()[index]
  if (script === undefined) {
    throw new Error(`тег gsi-скрипта #${String(index)} не найден`)
  }
  script.dispatchEvent(new Event(event))
}

/**
 * Очередь микротасок: до `initialize`/`prompt` модуль доходит не в первом тике
 * (загрузка скрипта, затем nonce-запрос).
 */
async function flushMicrotasks(): Promise<void> {
  for (let iteration = 0; iteration < 16; iteration += 1) {
    await Promise.resolve()
  }
}

async function loadModules(clientId: string = CLIENT_ID): Promise<OneTapModules> {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', clientId)
  vi.resetModules()
  const mod = await import('@/lib/google-one-tap')
  return {
    startGoogleOneTap: mod.startGoogleOneTap,
    loadGoogleGsiScript: (): Promise<boolean> => mod.loadGoogleGsiScript(),
  }
}

function lastInitializeConfig(google: GoogleIdSpy): InitializeConfigFixture {
  const config = google.configs.at(-1)
  if (config === undefined) {
    throw new Error('google.accounts.id.initialize не вызывался')
  }
  return config
}

function lastNotifier(google: GoogleIdSpy): PromptNotifier {
  const notifier = google.notifiers.at(-1)
  if (notifier === undefined) {
    throw new Error('google.accounts.id.prompt не вызывался')
  }
  return notifier
}

function notificationFixture(flags: {
  isNotDisplayed?: boolean
  isSkippedMoment?: boolean
  isDismissedMoment?: boolean
}): PromptNotificationFixture {
  return {
    isNotDisplayed: (): boolean => flags.isNotDisplayed === true,
    isSkippedMoment: (): boolean => flags.isSkippedMoment === true,
    isDismissedMoment: (): boolean => flags.isDismissedMoment === true,
  }
}

/** Запуск гостю с уже влитым gsi: дожидается initialize+prompt. */
async function startAsGuest(startGoogleOneTap: () => Promise<boolean>): Promise<OneTapAttempt> {
  const google = installGoogleIdSpy()
  const pending = startGoogleOneTap()
  await flushMicrotasks()
  return { google, config: lastInitializeConfig(google), pending }
}

function readyNonce(): void {
  api.apiGet.mockResolvedValue({ nonce: 'nonce-42' })
}

/**
 * Nonce по счётчику. С постоянным мок-значением перезапрос nonce после отказа
 * неотличим от переиспользования старого — а это ровно та ошибка, из-за которой
 * обмен отбивается сервером.
 */
function readyNonceSequence(): void {
  let counter = 0
  api.apiGet.mockImplementation(async () => {
    counter += 1
    return { nonce: `nonce-${String(counter)}` }
  })
}

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiPost.mockReset()
  api.setAccessToken.mockReset()
  storeState.setSession.mockReset()
  storeState.token = null
  storeState.user = null
  removeGoogle()
  dropGsiScripts()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  dropGsiScripts()
  removeGoogle()
  window.history.replaceState(null, '', '/')
})

describe('loadGoogleGsiScript', () => {
  it('gsi уже в документе: успех кеширован, нового тега нет', async () => {
    installGoogleIdSpy()
    const { loadGoogleGsiScript } = await loadModules()

    await expect(loadGoogleGsiScript()).resolves.toBe(true)
    expect(gsiScriptTags()).toHaveLength(0)
  })

  it('параллельные попытки — один тег; провал не кешируется и мёртвый тег убирается', async () => {
    const { loadGoogleGsiScript } = await loadModules()
    const appended = vi.spyOn(document.head, 'appendChild')

    const first = loadGoogleGsiScript()
    const second = loadGoogleGsiScript()
    expect(gsiScriptTags()).toHaveLength(1)
    expect(appended).toHaveBeenCalledTimes(1)

    fireGsiScript('error')
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    // Сбойный <script> в DOM не остаётся: иначе на плохой сети их набивается сколько
    // угодно (по одному на каждую неудачную попытку).
    expect(gsiScriptTags()).toHaveLength(0)

    const retry = loadGoogleGsiScript()
    expect(appended).toHaveBeenCalledTimes(2)
    expect(gsiScriptTags()).toHaveLength(1)
    installGoogleIdSpy()
    fireGsiScript('load', 0)
    await expect(retry).resolves.toBe(true)
    expect(gsiScriptTags()).toHaveLength(1)
  })

  it('таймаут 5 с: ждём ровно до него, потом false', async () => {
    vi.useFakeTimers()
    const { loadGoogleGsiScript } = await loadModules()

    let settled = false
    const pending = loadGoogleGsiScript().then((value: boolean): boolean => {
      settled = true
      return value
    })

    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    await expect(pending).resolves.toBe(false)
  })
})

describe('startGoogleOneTap', () => {
  it('гость с client_id: initialize+prompt, а credential меняет на сессию', async () => {
    readyNonce()
    api.apiPost.mockResolvedValue(okSession())
    const { startGoogleOneTap } = await loadModules()

    const attempt = await startAsGuest(startGoogleOneTap)

    expect(api.apiGet).toHaveBeenCalledWith('/auth/google/one-tap/nonce')
    expect(attempt.config).toMatchObject({
      client_id: CLIENT_ID,
      nonce: 'nonce-42',
      auto_select: false,
      cancel_on_tap_outside: true,
    })
    expect(attempt.google.notifiers).toHaveLength(1)

    attempt.config.callback({ credential: CREDENTIAL })
    await expect(attempt.pending).resolves.toBe(true)

    expect(api.apiPost).toHaveBeenCalledWith('/auth/google/credential', {
      credential: CREDENTIAL,
    })
    expect(api.setAccessToken).toHaveBeenCalledWith('ga-token')
    expect(storeState.setSession).toHaveBeenCalledWith('ga-token', GUEST_USER)
  })

  it('уже залогинен: ни запроса, ни подсказки, ни скрипта', async () => {
    storeState.token = 'living-token'
    const { startGoogleOneTap } = await loadModules()

    await expect(startGoogleOneTap()).resolves.toBe(false)

    storeState.token = null
    storeState.user = GUEST_USER
    await expect(startGoogleOneTap()).resolves.toBe(false)

    expect(api.apiGet).not.toHaveBeenCalled()
    expect(api.apiPost).not.toHaveBeenCalled()
    expect(gsiScriptTags()).toHaveLength(0)
  })

  it('без client_id не происходит ничего', async () => {
    const { startGoogleOneTap } = await loadModules('')

    await expect(startGoogleOneTap()).resolves.toBe(false)

    expect(api.apiGet).not.toHaveBeenCalled()
    expect(api.apiPost).not.toHaveBeenCalled()
    expect(gsiScriptTags()).toHaveLength(0)
  })

  it('скрипт не загрузился: false, nonce не просим, initialize не вызван', async () => {
    const { startGoogleOneTap } = await loadModules()

    const pending = startGoogleOneTap()
    fireGsiScript('error')

    await expect(pending).resolves.toBe(false)
    expect(api.apiGet).not.toHaveBeenCalled()
  })

  it('nonce не пришёл или пустой: подсказку не инициализируем', async () => {
    api.apiGet.mockRejectedValue(new Error('503'))
    const google = installGoogleIdSpy()
    const { startGoogleOneTap } = await loadModules()

    await expect(startGoogleOneTap()).resolves.toBe(false)

    api.apiGet.mockResolvedValue({ nonce: '' })
    await expect(startGoogleOneTap()).resolves.toBe(false)

    expect(google.configs).toHaveLength(0)
    expect(api.apiPost).not.toHaveBeenCalled()
  })

  it('карточку не показали или игрок отказался: false без обмена и без висячего промиса', async () => {
    readyNonce()
    const { startGoogleOneTap } = await loadModules()

    const notDisplayed = await startAsGuest(startGoogleOneTap)
    lastNotifier(notDisplayed.google)(notificationFixture({ isNotDisplayed: true }))
    await expect(notDisplayed.pending).resolves.toBe(false)

    const skipped = await startAsGuest(startGoogleOneTap)
    lastNotifier(skipped.google)(notificationFixture({ isSkippedMoment: true }))
    await expect(skipped.pending).resolves.toBe(false)

    // «Не сейчас» обязан резолвить тоже: висячий промис оставил бы single-flight
    // занятым до перезагрузки, и подсказка больше не появилась бы никогда.
    const dismissed = await startAsGuest(startGoogleOneTap)
    lastNotifier(dismissed.google)(notificationFixture({ isDismissedMoment: true }))
    await expect(dismissed.pending).resolves.toBe(false)

    expect(api.apiPost).not.toHaveBeenCalled()
    expect(api.setAccessToken).not.toHaveBeenCalled()
    expect(storeState.setSession).not.toHaveBeenCalled()
  })

  it('callback без credential или с пустым: false и никакого обмена', async () => {
    readyNonce()
    const { startGoogleOneTap } = await loadModules()

    const missing = await startAsGuest(startGoogleOneTap)
    missing.config.callback({})
    await expect(missing.pending).resolves.toBe(false)

    const blank = await startAsGuest(startGoogleOneTap)
    blank.config.callback({ credential: '' })
    await expect(blank.pending).resolves.toBe(false)

    expect(api.apiPost).not.toHaveBeenCalled()
    expect(storeState.setSession).not.toHaveBeenCalled()
  })

  it('обмен отбит: одна перезапроска nonce, при втором отказе false без токена', async () => {
    readyNonceSequence()
    api.apiPost.mockRejectedValue(new Error('nonce не совпал'))
    const { startGoogleOneTap } = await loadModules()

    const attempt = await startAsGuest(startGoogleOneTap)
    attempt.config.callback({ credential: CREDENTIAL })
    await flushMicrotasks()
    // Кука nonce на браузер одна: вторая вкладка перезаписывает её, и отказ
    // обмена — повод один раз взять новый nonce, а не сдачиваться.
    const second = lastInitializeConfig(attempt.google)
    expect(second.nonce).not.toBe(attempt.config.nonce)
    second.callback({ credential: CREDENTIAL })

    await expect(attempt.pending).resolves.toBe(false)
    expect(api.apiGet).toHaveBeenCalledTimes(2)
    expect(api.apiPost).toHaveBeenCalledTimes(2)
    expect(api.setAccessToken).not.toHaveBeenCalled()
    expect(storeState.setSession).not.toHaveBeenCalled()
  })

  it('обмен отбит первый раз и удался со второго: вход состоялся', async () => {
    readyNonce()
    api.apiPost
      .mockRejectedValueOnce(new Error('nonce не совпал'))
      .mockResolvedValueOnce(okSession())
    const { startGoogleOneTap } = await loadModules()

    const attempt = await startAsGuest(startGoogleOneTap)
    attempt.config.callback({ credential: CREDENTIAL })
    await flushMicrotasks()
    lastInitializeConfig(attempt.google).callback({ credential: CREDENTIAL })

    await expect(attempt.pending).resolves.toBe(true)
    expect(api.setAccessToken).toHaveBeenCalledWith('ga-token')
    expect(storeState.setSession).toHaveBeenCalledTimes(1)
  })

  it('тап по карточке после входа по паролю: обмена нет и сессия не подменяется', async () => {
    readyNonce()
    api.apiPost.mockResolvedValue(okSession())
    const { startGoogleOneTap } = await loadModules()

    const attempt = await startAsGuest(startGoogleOneTap)
    // Карточка висела, игрок за это время вошёл по паролю (или во второй вкладке).
    storeState.token = 'password-session'
    storeState.user = { id: 'u9', email: 'other@mail.test', role: 'user' }
    attempt.config.callback({ credential: CREDENTIAL })
    lastNotifier(attempt.google)(notificationFixture({ isDismissedMoment: true }))

    await expect(attempt.pending).resolves.toBe(false)
    expect(api.apiPost).not.toHaveBeenCalled()
    expect(api.setAccessToken).not.toHaveBeenCalled()
    expect(storeState.setSession).not.toHaveBeenCalled()
  })

  it('второй callback той же попытки не удваивает обмен', async () => {
    readyNonce()
    api.apiPost.mockResolvedValue(okSession())
    const { startGoogleOneTap } = await loadModules()

    const attempt = await startAsGuest(startGoogleOneTap)
    // Google зовёт callback и по старой карточке после перезаписи nonce: второй
    // запрос с тем же credential сервер всё равно отклоняет, слать его незачем.
    attempt.config.callback({ credential: CREDENTIAL })
    attempt.config.callback({ credential: CREDENTIAL })

    await expect(attempt.pending).resolves.toBe(true)
    expect(api.apiPost).toHaveBeenCalledTimes(1)
    expect(storeState.setSession).toHaveBeenCalledTimes(1)
  })

  it('тихий ?ref= едет в referral_code, без ref и с пустым ref поля нет', async () => {
    readyNonce()
    api.apiPost.mockResolvedValue(okSession())
    const { startGoogleOneTap } = await loadModules()

    const cases: ReferralCase[] = [
      { search: '/?ref=AB12', body: { credential: CREDENTIAL, referral_code: 'AB12' } },
      { search: '/', body: { credential: CREDENTIAL } },
      { search: '/?ref=', body: { credential: CREDENTIAL } },
    ]

    for (const currentCase of cases) {
      window.history.replaceState(null, '', currentCase.search)
      const attempt = await startAsGuest(startGoogleOneTap)
      attempt.config.callback({ credential: CREDENTIAL })
      await expect(attempt.pending).resolves.toBe(true)
      expect(api.apiPost).toHaveBeenLastCalledWith('/auth/google/credential', currentCase.body)
    }
    expect(api.apiPost).toHaveBeenCalledTimes(3)
  })

  it('две параллельные вызова — один nonce-запрос и одна подсказка', async () => {
    readyNonce()
    const google = installGoogleIdSpy()
    const { startGoogleOneTap } = await loadModules()

    const first = startGoogleOneTap()
    const second = startGoogleOneTap()
    await flushMicrotasks()

    expect(second).toBe(first)
    expect(api.apiGet).toHaveBeenCalledTimes(1)
    expect(google.configs).toHaveLength(1)

    lastNotifier(google)(notificationFixture({ isNotDisplayed: true }))
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    expect(google.configs).toHaveLength(1)
  })

  it('после завершения single-flight снимается: второй заход просит nonce заново', async () => {
    readyNonce()
    const { startGoogleOneTap } = await loadModules()

    const first = await startAsGuest(startGoogleOneTap)
    lastNotifier(first.google)(notificationFixture({ isNotDisplayed: true }))
    await expect(first.pending).resolves.toBe(false)

    const second = await startAsGuest(startGoogleOneTap)
    lastNotifier(second.google)(notificationFixture({ isNotDisplayed: true }))
    await expect(second.pending).resolves.toBe(false)

    expect(api.apiGet).toHaveBeenCalledTimes(2)
  })
})
