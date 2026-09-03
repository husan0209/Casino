'use client'
import axios, { type AxiosError } from 'axios'

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1'

/** P1 #11: withCredentials — httpOnly refresh-cookie уходит на /auth/refresh. */
export const api = axios.create({ baseURL: API_URL, withCredentials: true })

/**
 * Ответ API в конверте: TransformInterceptor оборачивает в {success,data}.
 * Экспортирован для api-interceptors.ts (refresh читает accessToken из data).
 */
export interface ApiResponse<T> {
  success?: boolean
  data: T
  message?: string
  error?: { message?: string; code?: string }
}

/**
 * GET c разворачиванием конверта {success,data} → data.
 * Interceptors (auth-token + silent refresh) подключаются отдельным модулем
 * lib/api-interceptors.ts из providers.tsx — без цикла lib/api <-> stores/auth.
 */
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
  return ax?.response?.data.error?.code
}

export function errText(e: unknown): string {
  const ax = e as AxiosError<ApiResponse<unknown>> | null
  const respData = ax?.response?.data
  return (
    respData?.error?.message ??
    respData?.message ??
    (e as Error).message ||
    'Ошибка'
  )
}
