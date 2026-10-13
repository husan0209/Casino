'use client'

import { apiGet, apiPost, setAccessToken } from '@/lib/api'
import { type WebUser, useAuthStore } from '@/stores/auth'

/**
 * Google One Tap — карточка «Продолжить как <имя>» в углу страницы.
 *
 * Как это выглядит для игрока: справа вверху появляется подсказка с его аватаром,
 * именем и почтой; один тап — и он на сайте, без пароля и без редиректа. Диалог
 * рисует браузер (FedCM), а не страница, поэтому подделать его версткой нельзя.
 *
 * Что уходит серверу: `credential` — подписанный Google ID-токен. Это
 * предъявительский артефакт (кто принёс, тот и вошёл), поэтому сервер сверяет
 * подпись по JWKS Google, проверяет `iss`/`aud`/срок и обязан совпасть nonce из
 * httpOnly-куки, выданной именно этому браузеру. Без nonce украденный токен
 * оставался бы ключом к чужому аккаунту весь час своей жизни.
 *
 * Чего здесь сознательно нет:
 * - подсказки залогиненному: обещание второго аккаунта в углу работающей сессии —
 *   это не UX, а приглашение перепутать кошельки;
 * - `auto_select`: вход без единого действия игрока нам не нужен, тап по карточке
 *   и есть это действие (он же закрывает вопрос молчаливой регистрации);
 * - ошибки на экране: провал подсказки = обычный экран входа, тоста нет.
 */

const GSI_SCRIPT_URL = 'https://accounts.google.com/gsi/client'
const SCRIPT_TIMEOUT_MS = 5000

/** Пустая строка = «не настроено»: сборка без ключа не должна просить nonce. */
export const GOOGLE_ONE_TAP_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] || undefined

interface CredentialResponse {
  credential?: string
}

interface PromptNotification {
  isNotDisplayed: () => boolean
  isSkippedMoment: () => boolean
  isDismissedMoment: () => boolean
}

interface GoogleIdApi {
  initialize: (config: {
    client_id: string
    nonce: string
    auto_select: boolean
    cancel_on_tap_outside: boolean
    callback: (response: CredentialResponse) => void
  }) => void
  prompt: (notifier?: (notification: PromptNotification) => void) => void
}

function gsiIdApi(): GoogleIdApi | null {
  const scope = window as Window & { google?: { accounts?: { id?: GoogleIdApi } } }
  return scope.google?.accounts?.id ?? null
}

let loadPending: Promise<boolean> | null = null

/**
 * Один тег <script> на документ. Успех кешируем (`gsiIdApi() !== null`),
 * неудача — нет: без этого одна заглючившая загрузка отключала бы подсказку до
 * конца жизни вкладки.
 */
export function loadGoogleGsiScript(doc: Document = document): Promise<boolean> {
  const already = gsiIdApi()
  if (already !== null) {
    return Promise.resolve(true)
  }
  if (loadPending !== null) {
    return loadPending
  }
  loadPending = new Promise<boolean>((resolve): void => {
    const script = doc.createElement('script')
    script.src = GSI_SCRIPT_URL
    script.async = true
    const settle = (value: boolean): void => {
      window.clearTimeout(timer)
      loadPending = null
      resolve(value)
    }
    const timer = window.setTimeout((): void => {
      script.remove()
      settle(false)
    }, SCRIPT_TIMEOUT_MS)
    script.onload = (): void => settle(gsiIdApi() !== null)
    // Сбойный тег убираем: иначе каждая повторная попытка оставляет в <head>
    // мёртвый <script>, и на медленной сети их наберётся сколько угодно.
    script.onerror = (): void => {
      script.remove()
      settle(false)
    }
    doc.head.appendChild(script)
  })
  return loadPending
}

/**
 * 'signed' — вошли; 'rejected' — карточку показали и тап состоялся, но сервер
 * отказал; 'no-prompt' — подсказки не было (не показана, провал скрипта/nonce).
 */
type AttemptOutcome = 'signed' | 'rejected' | 'no-prompt'

/**
 * Обмен credential на сессию. Ошибку не показываем ни в каком виде: One Tap —
 * дополнительный путь входа, и его провал не имеет права кричать тому, кто идёт
 * по паролю.
 */
async function exchangeCredential(credential: string): Promise<AttemptOutcome> {
  const referral = new URLSearchParams(window.location.search).get('ref')
  try {
    const result = await apiPost<{ accessToken: string; user: WebUser }>(
      '/auth/google/credential',
      {
        credential,
        ...(referral !== null && referral !== '' ? { referral_code: referral } : {}),
      },
    )
    setAccessToken(result.accessToken)
    // setSession перечитывает гейт акцепта оферты: вход по One Tap не обходит 18+.
    useAuthStore.getState().setSession(result.accessToken, result.user)
    return 'signed'
  } catch {
    return 'rejected'
  }
}

/** Одна попытка: nonce → initialize → prompt. */
async function attempt(gsi: GoogleIdApi): Promise<AttemptOutcome> {
  // Nonce выдаёт наш сервер и тут же кладёт в httpOnly-куку. Порядок важен:
  // initialize обязан получить значение ДО показа карточки, иначе Google не
  // включит его в токен и обмен отобьётся как «nonce не совпал».
  let nonce = ''
  try {
    nonce = (await apiGet<{ nonce: string }>('/auth/google/one-tap/nonce')).nonce
  } catch {
    return 'no-prompt'
  }
  if (typeof nonce !== 'string' || nonce === '') {
    return 'no-prompt'
  }

  return new Promise<AttemptOutcome>((resolve): void => {
    let settled = false
    let exchanging = false
    const finish = (value: AttemptOutcome): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
    }
    gsi.initialize({
      client_id: GOOGLE_ONE_TAP_CLIENT_ID ?? '',
      nonce,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (response: CredentialResponse): void => {
        const credential = response.credential
        if (typeof credential !== 'string' || credential === '') {
          finish('no-prompt')
          return
        }
        // «Я гость» проверяем в момент тапа, а не только на входе: карточка висит
        // сколько угодно долго, и за это время игрок успевает войти по паролю (или
        // во второй вкладке). Обмен в такой ситуации — молчаливая подмена аккаунта
        // под ногами: setSession перезаписал бы рабочую сессию чужой.
        const current = useAuthStore.getState()
        if (current.token !== null || current.user !== null) {
          finish('no-prompt')
          return
        }
        // Один обмен на попытку: Google зовёт callback и по старой карточке после
        // перезаписи nonce, а второй запрос с тем же credential сервер всё равно
        // не примет — незачем слать его дважды.
        if (exchanging) {
          return
        }
        exchanging = true
        void exchangeCredential(credential).then(finish)
      },
    })
    gsi.prompt((notification: PromptNotification): void => {
      // Карточка не показана (нет сессии Google, показывали слишком часто, браузер
      // не поддержал FedCM) или игрок отказался — живём без неё: гость видит обычный
      // экран входа. Резолвить нужно и на dismissed: иначе промис висел бы до
      // перезагрузки страницы и блокировал single-flight.
      if (
        notification.isNotDisplayed() ||
        notification.isSkippedMoment() ||
        notification.isDismissedMoment()
      ) {
        finish('no-prompt')
      }
    })
  })
}

async function run(): Promise<boolean> {
  if (GOOGLE_ONE_TAP_CLIENT_ID === undefined) {
    return false
  }
  const state = useAuthStore.getState()
  if (state.token !== null || state.user !== null) {
    return false
  }
  if (!(await loadGoogleGsiScript())) {
    return false
  }
  const gsi = gsiIdApi()
  if (gsi === null) {
    return false
  }

  const first = await attempt(gsi)
  if (first === 'signed') {
    return true
  }
  if (first === 'no-prompt') {
    return false
  }
  // Тап был, а сервер отказал. Самая бытовая причина — другая вкладка: кука nonce
  // на браузер одна, и второй запрос перезаписывает первую. Один ретрай с новым
  // nonce снимает гонку; повторять больше незачем, и Google частит с показом.
  return (await attempt(gsi)) === 'signed'
}

let inFlight: Promise<boolean> | null = null

/**
 * Попробовать показать One Tap. `true` — игрок вошёл; `false` — не настроено, уже
 * залогинен, карточка не показана или обмен не удался. Single-flight: StrictMode
 * монтирует эффект дважды, и без общей промисы получили бы два запроса nonce и
 * две попытки подсказки подряд.
 */
export function startGoogleOneTap(): Promise<boolean> {
  if (inFlight !== null) {
    return inFlight
  }
  inFlight = run().finally((): void => {
    inFlight = null
  })
  return inFlight
}
