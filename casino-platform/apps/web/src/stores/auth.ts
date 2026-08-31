'use client'
import { create } from 'zustand'

import { apiGet, apiPost } from '@/lib/api'

export interface WebUser {
  id: string
  email: string | null
  role: string
}

interface AuthState {
  token: string | null
  user: WebUser | null
  /** P1 #11: попытка восстановления сессии уже была (после reload) */
  hydrated: boolean
  /** login возвращает {accessToken, user}; refresh-token живёт в httpOnly-cookie на API */
  login: (email: string, password: string) => Promise<void>
  setSession: (token: string, user: WebUser) => void
  setAuth: (user: WebUser, token: string) => void
  register: (email: string, password: string, referralCode?: string) => Promise<void>
  logout: () => void
  /**
   * P1 #11: сессия после перезагрузки страницы. Access-token живёт ТОЛЬКО
   * в памяти (localStorage — запрещён как XSS-мишень), поэтому после reload
   * получаем новый по httpOnly-cookie (/auth/refresh) и подтягиваем профиль.
   */
  hydrate: () => Promise<void>
}

export const useAuth = create<AuthState>()((set, get) => ({
  token: null,
  user: null,
  hydrated: false,
  login: async (email, password) => {
    const res = await apiPost<any>('/auth/login', { email, password })
    if (!res?.accessToken) {
      throw new Error(res?.error?.message || 'Ошибка входа')
    }
    set({ token: res.accessToken, user: res.user })
  },
  setSession: (token, user) => set({ token, user }),
  /** verify-email flow */
  setAuth: (user, token) => set({ token, user }),
  /** регистрация нового пользователя (письмо-подтверждение уходит с API) */
  register: async (email, password, referralCode) => {
    const res = await apiPost<any>('/auth/register', {
      email,
      password,
      referral_code: referralCode,
    })
    if (res?.accessToken) {
      set({ token: res.accessToken, user: res.user })
      return
    }
    throw new Error(res?.error?.message || 'Ошибка регистрации')
  },
  logout: () => {
    // серверная часть: инвалидирует refresh-токен и чистит httpOnly-cookie
    // (fire-and-forget: при истёкшей сессии /auth/logout вернёт 401 — не страшно)
    void apiPost('/auth/logout').catch(() => {})
    set({ token: null, user: null })
  },
  hydrate: async () => {
    if (get().hydrated || get().token) {
      return
    }
    try {
      const res = await apiPost<any>('/auth/refresh')
      if (!res?.accessToken) {
        throw new Error('no access token')
      }
      set({ token: res.accessToken })
      const me = await apiGet<WebUser>('/users/me')
      set({ user: me ?? null, hydrated: true })
    } catch {
      set({ token: null, user: null, hydrated: true })
    }
  },
}))

/** Алиас для страниц, ожидающих useAuthStore-стиль */
export const useAuthStore = useAuth
