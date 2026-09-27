'use client'
import axios, { type AxiosError } from 'axios'

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1'

/**
 * Axios-инстанс без interceptor'ов (их подключает lib/api-interceptors.ts
 * из layout.tsx — без цикла lib/api <-> stores/auth).
 */
export const api = axios.create({ baseURL: API_URL })

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Разворачивает конверт списка контроллеров /admin/* в {rows, meta}.
 * Аудит контрактов 2026-09-26: листинги админки не имеют единой формы —
 *   {items, meta}      (admin/users, /withdrawals, /payment-requests,
 *                       /transactions, /audit-logs, /games)
 *   {items, total}     (admin/kyc — total без page/perPage)
 *   {data: rows, meta} (admin/support/tickets, admin/referrals)
 * — а страницы читают результат как массив + meta.total. Без нормализации
 * data.data.map() падал («… is not a function»), а pager всегда показывал 0.
 * Незнакомые payload (деталка тикета, plain-массив) проходят как есть.
 */
function unwrapListPayload(payload: unknown): { rows: unknown; meta: ApiMeta | undefined } {
  if (isRecord(payload) && Array.isArray(payload['items'])) {
    const meta = isRecord(payload['meta'])
      ? (payload['meta'] as ApiMeta)
      : typeof payload['total'] === 'number'
        ? { total: payload['total'] }
        : undefined
    return { rows: payload['items'], meta }
  }
  if (isRecord(payload) && Array.isArray(payload['data']) && isRecord(payload['meta'])) {
    return { rows: payload['data'], meta: payload['meta'] as ApiMeta }
  }
  return { rows: payload, meta: undefined }
}

/** GET c полным конвертом (когда нужна meta пагинации) */
export async function apiGetFull<T>(
  url: string,
  params?: Record<string, unknown>,
): Promise<{ data: T; meta?: ApiMeta | undefined }> {
  const res = await api.get<ApiResponse<unknown> & { meta?: ApiMeta }>(url, { params })
  const { rows, meta } = unwrapListPayload(res.data.data)
  return { data: rows as T, meta: meta ?? res.data.meta }
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
  const ax = e as AxiosError<ApiResponse<unknown>> | null
  const respData = ax?.response?.data
  return (
    respData?.error?.message ??
    respData?.message ??
    ((e as Error).message || 'Ошибка')
  )
}
