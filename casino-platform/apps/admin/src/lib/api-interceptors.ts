'use client'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

import type { AxiosError } from 'axios'

/**
 * Регистрирует axios-interceptors (auth-token + logout на 401).
 * Вынесено из lib/api.ts, чтобы разорвать цикл lib/api <-> stores/auth
 * (import/no-cycle, GAP-39 stage 9). Вызывается один раз из layout.
 */
export function setupApiInterceptors(): void {
  api.interceptors.request.use((config) => {
    const token = useAuthStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  api.interceptors.response.use(
    (res) => res,
    (err: AxiosError) => {
      if (err.response?.status === 401 && typeof window !== 'undefined') {
        useAuthStore.getState().logout()
        if (!window.location.pathname.endsWith('/')) {
          window.location.href = '/'
        }
      }
      return Promise.reject(err)
    },
  )
}
