'use client'
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { useAuthStore } from '@/stores/auth'

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1'

/** P1 #11: withCredentials — httpOnly refresh-cookie уходит на /auth/refresh. */
export const api = axios.create({ baseURL: API_URL, withCredentials: true })

let refreshPromise: Promise<boolean> | null = null

/** Ответ API в конверте: TransformInterceptor оборачивает в {success,data}. */
interface ApiResponse<T> {
  success?: boolean
  data: T
  message?: string
  error?: { message?: string; code?: string }
}

/**
 * P1 #11: silent refresh — один общий запрос (single-flight), чтобы параллельные
 * 401 не устроили шторм /auth/refresh. Новый access-token кладётся в память
 * стора (refresh-cookie ротируется сервером). Возвращает успех.
 */
function trySilentRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = axios
      // отдельный запрос без interceptor'ов — иначе зациклится на собственном 401
      .post<ApiResponse<{ accessToken: string }>>(`${API_URL}/auth/refresh`, null, { withCredentials: true })
      .then((r) => {
        const token: string | undefined = r.data?.data?.accessToken ?? r.data?.accessToken
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

/** GET c разворачиванием конверта {success,data} → data */
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<ApiResponse<T>>(url, { params })
  return res.data.data
}

/** POST c разворачиванием конверта {success,data} → data */
export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.post<ApiResponse<T>>(url, body)
  return res.data.data
}

/** PATCH c разворачиванием конверта {success,data} → data */
export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch<ApiResponse<T>>(url, body)
  return res.data.data
}

export function setAccessToken(token: string): void {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common.Authorization
  }
}

/** Код ошибки из конверта (для branch-логики по коду, напр. INSUFFICIENT_FUNDS). */
export function errCode(e: unknown): string | undefined {
  const ax = e as AxiosError<ApiResponse<unknown>> | null
  return ax?.response?.data?.error?.code
}

export function errText(e: unknown): string {
  const ax = e as AxiosError<ApiResponse<unknown>> | null
  const respData = ax?.response?.data
  return (
    respData?.error?.message ??
    respData?.message ??
    (e as Error).message ??
    'Ошибка'
  )
}
