'use client'
import axios, { AxiosError } from 'axios'
import { useAuthStore } from '@/stores/auth'

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1'

export const api = axios.create({ baseURL: API_URL })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      useAuthStore.getState().logout()
    }
    return Promise.reject(err)
  },
)

/** GET c разворачиванием конверта {success,data} → data */
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get(url, { params })
  return res.data?.data as T
}

export async function apiPost<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await api.post(url, body)
  return res.data?.data ?? res.data
}

export async function apiPatch<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch(url, body)
  return res.data?.data ?? res.data
}

export function setAccessToken(token: string) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`
  else delete api.defaults.headers.common.Authorization
}

export function errText(e: unknown): string {
  const ax = e as AxiosError<any>
  return ax?.response?.data?.error?.message ?? ax?.response?.data?.message ?? (e as Error)?.message ?? 'Ошибка'
}
