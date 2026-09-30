'use client'
import axios, { type AxiosError } from 'axios'

import { type ApiResponse } from '@/lib/api'
import { API_BASE_URL as API_URL } from '@/lib/api-base'

/**
 * Клиент партнёрской программы.
 *
 * ОТДЕЛЬНЫЙ экземпляр axios — не косметика. Партнёрский токен имеет
 * `aud=affiliate` и общий axios игрока уже несёт `aud=user`. Если бы запросы
 * кабинета шли через общий `api`, то:
 *  - партнёрский кабинет отдавал бы 401 (guard отвергает чужой aud);
 *  - а перезагрузка страницы проставила бы партнёрский токен в игровой клиент,
 *    и наоборот — игрок потерял бы сессию на сайте.
 *
 * Клиент создан без `withCredentials`: refresh-токен партнёра в MVP не
 * выдаётся, доступ живёт до перезагрузки (см. docs/tz-part-8 §10.1).
 */
export const affiliateApi = axios.create({ baseURL: API_URL })

export function setAffiliateToken(token: string): void {
  if (token) {
    affiliateApi.defaults.headers.common.Authorization = `Bearer ${token}`
  } else {
    delete affiliateApi.defaults.headers.common.Authorization
  }
}

export async function affiliateGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await affiliateApi.get<ApiResponse<T>>(url, { params })
  return res.data.data
}

export async function affiliatePost<T>(url: string, body?: unknown): Promise<T> {
  const res = await affiliateApi.post<ApiResponse<T>>(url, body)
  return res.data.data
}

export async function affiliatePatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await affiliateApi.patch<ApiResponse<T>>(url, body)
  return res.data.data
}

/** Текст ошибки партнёрского контура (тот же контракт, что у api.errText). */
export function affiliateErrText(error: unknown): string {
  const ax = error as AxiosError<ApiResponse<unknown>> | null
  const data = ax?.response?.data
  return data?.error?.message ?? ((error as Error).message || 'Ошибка')
}
