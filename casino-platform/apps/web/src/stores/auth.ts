'use client'
import { create } from 'zustand'

import { apiGet, apiPost } from '@/lib/api'
import { type MeDto } from '@/types/user'

import { LEGAL_DOCUMENT_VERSIONS } from '@casino/shared-types'

export interface WebUser {
  id: string
  email: string | null
  role: string
}

/** Ответ /auth/login и /auth/register: {accessToken, user}. */
interface AuthResponse {
  accessToken: string
  user: WebUser
  /** GAP-73 (Terms §21): условия менялись после последнего акцепта игрока. */
  terms_reaccept_required?: boolean
}

export interface AuthState {
  token: string | null
  user: WebUser | null
  /** P1 #11: попытка восстановления сессии уже была (после reload) */
  hydrated: boolean
  /**
   * Гейт повторного акцепта (GAP-73, Terms §21): ставится из ответа /auth/login
   * и снимается успешным POST /auth/terms/accept.
   */
  termsReacceptRequired: boolean
  /** login возвращает {accessToken, user}; refresh-token живёт в httpOnly-cookie на API */
  login: (email: string, password: string, captchaToken?: string) => Promise<void>
  /** Подтвердить действующую редакцию Условий и политики (Terms §21). */
  acceptTerms: () => Promise<void>
  setSession: (token: string, user: WebUser) => void
  setAuth: (user: WebUser, token: string) => void
  /**
   * Регистрация игрока.
   *
   * `referralCode` — игровая рефералка, `affiliateCode` — партнёрская программа
   * (ТЗ ч.8 §7.3). Это две РАЗНЫЕ программы (рефералы игроков §9 и партнёры §9a
   * в MODULE_BOUNDARIES), и сервер резолвит каждую в своей таблице. Оба
   * необязательны: обычная регистрация не отличается по форме запроса.
   */
  register: (
    email: string,
    password: string,
    /**
     * `termsVersion` — версия условий, которую игрок видел на форме (GAP-71,
     * Terms §4). Передана внутри объекта, а не четвёртым аргументом: max-params
     * в этом пакете — 3. Обязательное поле, а не опция: без него сервер не
     * зафиксирует акцепт.
     */
    input: {
      referral?: string | undefined
      affiliate?: string | undefined
      termsVersion: string
    },
  ) => Promise<void>
  logout: () => void
  /**
   * P1 #11: сессия после перезагрузки страницы. Access-token живёт ТОЛЬКО
   * в памяти (localStorage — запрещён как XSS-мишень), поэтому после reload
   * получаем новый по httpOnly-cookie (/auth/refresh) и подтягиваем профиль.
   */
  hydrate: () => Promise<void>
}

type AuthSetter = (patch: Partial<AuthState>) => void

/**
 * Перечитать гейт повторного акцепта (GAP-73, Terms §21) для уже открытой сессии.
 *
 * Нужен там, где сессия возникает вне `login()`: OAuth-колбэк, подтверждение
 * письма, гидрация после reload. Ответа логина, из которого берётся флаг, в этих
 * путях нет, а требование подтвердить новую редакцию при входе от способа входа
 * не зависит.
 *
 * Ошибку глотаем: недоступная проверка — не основание выбрасывать игрока из
 * рабочей сессии, при следующем входе сервер скажет заново.
 */
async function refreshTermsFlag(set: AuthSetter): Promise<void> {
  try {
    const res = await apiGet<{ reacceptRequired: boolean }>('/auth/terms-acceptances')
    set({ termsReacceptRequired: res.reacceptRequired === true })
  } catch {
    /* флаг остаётся таким, как его поставил последний успешный ответ сервера */
  }
}

/** Открыть сессию вне `login()` (OAuth, подтверждение письма) и перечитать гейт. */
function openSession(set: AuthSetter, token: string, user: WebUser): void {
  set({ token, user })
  void refreshTermsFlag(set)
}

export const useAuth = create<AuthState>()((set, get) => ({
  token: null,
  user: null,
  hydrated: false,
  termsReacceptRequired: false,
  login: async (email, password, captchaToken) => {
    // GAP-55 (ж): captcha_token добавляется только когда бэк его попросил
    // (CAPTCHA_REQUIRED) — обычный запрос остаётся прежним.
    const res = await apiPost<AuthResponse>('/auth/login', {
      email,
      password,
      ...(captchaToken !== undefined && captchaToken.length > 0
        ? { captcha_token: captchaToken }
        : {}),
    })
    set({
      token: res.accessToken,
      user: res.user,
      termsReacceptRequired: res.terms_reaccept_required === true,
    })
  },
  acceptTerms: async () => {
    // Версия берётся из того же реестра, что печатает страницу /legal/terms, —
    // сервер сверит её и запишет новую строку журнала (GAP-71/§21).
    const res = await apiPost<{ reacceptRequired: boolean }>('/auth/terms/accept', {
      terms_version: LEGAL_DOCUMENT_VERSIONS.terms,
    })
    // Флаг снимаем по ответу сервера, а не «потому что запрос прошёл»: если
    // реестр успел уехать вперёд, гейт должен остаться.
    set({ termsReacceptRequired: res.reacceptRequired === true })
  },
  setSession: (token, user) => openSession(set, token, user),
  /** verify-email flow */
  setAuth: (user, token) => openSession(set, token, user),
  /** регистрация нового пользователя (письмо-подтверждение уходит с API) */
  register: async (email, password, input) => {
    const res = await apiPost<AuthResponse>('/auth/register', {
      email,
      password,
      referral_code: input.referral,
      // GAP-71: согласие — часть запроса, а не следствие успешной регистрации.
      accept_terms: true,
      terms_version: input.termsVersion,
      // Код партнёра едет в query-параметре ref (его читает RegisterController).
      ...(input.affiliate !== undefined && input.affiliate !== '' ? { ref: input.affiliate } : {}),
    })
    // Новый аккаунт: сервер только что записал акцеп действующей версии,
    // поэтому сверять разрыв при регистрации не нужно.
    set({ token: res.accessToken, user: res.user })
  },
  logout: () => {
    // серверная часть: инвалидирует refresh-токен и чистит httpOnly-cookie
    // (fire-and-forget: при истёкшей сессии /auth/logout вернёт 401 — не страшно)
    void apiPost<unknown>('/auth/logout').catch(() => {})
    set({ token: null, user: null, termsReacceptRequired: false })
  },
  hydrate: async () => {
    if (get().hydrated || get().token) {
      return
    }
    try {
      const res = await apiPost<{ accessToken: string }>('/auth/refresh')
      if (!res.accessToken) {
        throw new Error('no access token')
      }
      set({ token: res.accessToken })
      // GET /users/me отдаёт {user, profile, settings, kycStatus} (GetMeUseCase ->
      // UserProfileFull) внутри конверта — пользователем является только поле user.
      // Найдено аудитом контрактов 2026-09-26: раньше весь объект уходил в store,
      // и у «пользователя» после перезагрузки страницы не было id/email/role.
      const me = await apiGet<MeDto>('/users/me')
      set({ user: me.user, hydrated: true })
      // void, а не await: отказ гейт-проверки не должен попасть в catch и
      // разлогинить игрока с рабочей сессией.
      void refreshTermsFlag(set)
    } catch {
      set({ token: null, user: null, hydrated: true })
    }
  },
}))

/** Алиас для страниц, ожидающих useAuthStore-стиль */
export const useAuthStore = useAuth
