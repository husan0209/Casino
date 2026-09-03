'use client'
import axios, { type AxiosError } from 'axios'

import { useAuthStore } from '@/stores/auth'

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1'

export const api = axios.create({ baseURL: API_URL })

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

/** Ответ API в конверте: TransformInterceptor оборачивает в {success,data}. */
interface ApiResponse<T> {
  success?: boolean
  data: T
  message?: string
  error?: { message?: string; code?: string }
}

/** Мета пагинации листингов админки. */
export interface ApiMeta {
  page?: number
  perPage?: number
  per_page?: number
  total?: number
  totalPages?: number
  total_pages?: number
  [key: string]: unknown
}

/** GET c разворачиванием конверта {success,data,meta} → data */
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<ApiResponse<T>>(url, { params })
  return res.data.data
}

/** GET c полным конвертом (когда нужна meta пагинации) */
export async function apiGetFull<T>(
  url: string,
  params?: Record<string, unknown>,
): Promise<{ data: T; meta?: ApiMeta }> {
  const res = await api.get<ApiResponse<T> & { meta?: ApiMeta }>(url, { params })
  return { data: res.data.data, meta: res.data.meta }
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

export function errText(e: unknown): string {
  const ax = e as AxiosError<ApiResponse<unknown>>
  return (
    ax.response?.data?.error?.message ??
    ax.response?.data?.message ??
    (e as Error).message ??
    'Ошибка'
  )
}
