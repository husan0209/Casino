'use client'
import axios, { type AxiosError } from 'axios'

import { type ApiResponse } from '@/lib/api'
import { API_BASE_URL as API_URL } from '@/lib/api-base'
import { affiliatePasswordErrorLabel } from '@/lib/ui/affiliate-password'

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

/** Код ошибки партнёрского контура (для branch-логики, как api.errCode у игрока). */
export function affiliateErrCode(error: unknown): string | undefined {
  const ax = error as AxiosError<ApiResponse<unknown>> | null
  return ax?.response?.data.error?.code
}

/** Текст ошибки партнёрского контура (тот же контракт, что у api.errText). */
export function affiliateErrText(error: unknown): string {
  const ax = error as AxiosError<ApiResponse<unknown>> | null
  const data = ax?.response?.data
  const message = data?.error?.message ?? (error as Error).message
  if (typeof message !== 'string' || message === '') {
    return 'Ошибка'
  }
  // VALIDATION_ERROR из ZodValidationPipe приходит как сериализованный массив
  // проблем ('[{"code":"invalid_literal",…}]') — показывать его игроку нельзя,
  // но внутри него лежит готовый человеческий текст от схемы.
  if (message.startsWith('[')) {
    try {
      const issues = JSON.parse(message) as Array<{ message?: unknown }>
      const first = Array.isArray(issues) ? issues[0]?.message : undefined
      if (typeof first === 'string' && first !== '') {
        return first
      }
    } catch {
      /* не JSON — отдаём как есть */
    }
  }
  return message
}

/**
 * Текст ошибки для операций с паролем партнёра.
 *
 * Сначала стабильный код (`AFFILIATE_TOKEN_*`, `WEAK_PASSWORD`,
 * `AFFILIATE_PASSWORD_INVALID_CURRENT`) → русская фраза из справочника. Если
 * кода в справочнике нет (`VALIDATION_ERROR` и всё будущее), отдаём штатный
 * разбор конверта: там уже лежит человеческий текст из Zod-схемы. Придумывать
 * свою формулировку вместо него нельзя — сервер её не гарантирует.
 */
export function affiliatePasswordErrText(error: unknown): string {
  const mapped = affiliatePasswordErrorLabel(affiliateErrCode(error))
  return mapped ?? affiliateErrText(error)
}
