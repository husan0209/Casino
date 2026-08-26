'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { apiPost } from '@/lib/api'

export interface WebUser { id: string; email: string | null; role: string }

interface AuthState {
  token: string | null
  refreshToken: string | null
  user: WebUser | null
  /** login возвращает {accessToken, user}; refreshToken лежит в httpOnly-cookie на API */
  login: (email: string, password: string) => Promise<void>
  setSession: (token: string, user: WebUser) => void
  setAuth: (user: WebUser, token: string) => void
  register: (email: string, password: string, referralCode?: string) => Promise<void>
  logout: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      login: async (email, password) => {
        const res = await apiPost<any>('/auth/login', { email, password })
        if (!res?.accessToken) throw new Error(res?.error?.message || 'Ошибка входа')
        set({ token: res.accessToken, user: res.user })
      },
      setSession: (token, user) => set({ token, user }),
      /** verify-email flow */
      setAuth: (user, token) => set({ token, user }),
      /** регистрация нового пользователя (письмо-подтверждение уходит с API) */
      register: async (email, password, referralCode) => {
        const res = await apiPost<any>('/auth/register', { email, password, referral_code: referralCode })
        if (res?.accessToken) {
          set({ token: res.accessToken, user: res.user })
          return
        }
        throw new Error(res?.error?.message || 'Ошибка регистрации')
      },
      logout: () => set({ token: null, refreshToken: null, user: null }),
    }),
    { name: 'casino-web-auth' },
  ),
)

/** Алиас для страниц, ожидающих useAuthStore-стиль */
export const useAuthStore = useAuth
