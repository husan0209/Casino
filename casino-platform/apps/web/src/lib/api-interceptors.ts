'use client'
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { API_URL, type ApiResponse, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

let refreshPromise: Promise<boolean> | null = null

/**
 * P1 #11: silent refresh — один общий запрос (single-flight), чтобы параллельные
 * 401 не устроили шторм /auth/refresh. Новый access-token кладётся в память
 * стора (refresh-cookie ротируется сервером). Возвращает успех.
 */
function trySilentRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = axios
      // отдельный запрос без interceptor'ов — иначе зациклится на собственном 401
      .post<ApiResponse<{ accessToken: string }>>(`${API_URL}/auth/refresh`, null, {
        withCredentials: true,
      })
      .then((r) => {
        const token: string | undefined = r.data.data.accessToken
        if (!token) {
          return false
        }
        useAuthStore.setState({ token })
        return true
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

/**
 * Регистрирует axios-interceptors (auth-token + silent refresh).
 * Вынесено из lib/api.ts, чтобы разорвать цикл lib/api <-> stores/auth
 * (import/no-cycle, GAP-39 stage 9). Вызывается один раз из providers.tsx.
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
    async (err: AxiosError) => {
      const status = err.response?.status
      const url = err.config?.url ?? ''
      // retry-запросы и вызовы /auth/* не ретраим (иначе цикл)
      const config = err.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
      const isAuthCall = url.includes('/auth/')
      if (status === 401 && config && !config._retry && !isAuthCall && typeof window !== 'undefined') {
        config._retry = true
        const ok = await trySilentRefresh()
        if (ok) {
          // повтор исходного запроса: request-interceptor подставит свежий токен
          return api.request(config)
        }
      }
      if (status === 401 && typeof window !== 'undefined') {
        // refresh не удался/не проводился — чистим память (cookie чистит сервер на logout)
        useAuthStore.setState({ token: null, user: null })
      }
      return Promise.reject(err)
    },
  )
}
