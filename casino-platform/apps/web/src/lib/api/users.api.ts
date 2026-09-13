/**
 * GAP-52 (ТЗ ч.5 §9): API-домен профиля — сессии, настройки, смена пароля.
 * Контракты соответствуют users.controller / auth.controller (snake_case body).
 */
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import type { SessionDto } from '@/types/user'

export function listSessions(): Promise<SessionDto[]> {
  return apiGet<SessionDto[]>('/users/me/sessions')
}

/** Завершить конкретную сессию (текущую нельзя — 403, как в RevokeSessionUseCase). */
export function revokeSession(sessionId: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/users/me/sessions/${sessionId}`)
}

/** Завершить все сессии кроме текущей. */
export function revokeAllSessions(): Promise<{ ok: boolean; revoked: number }> {
  return apiDelete<{ ok: boolean; revoked: number }>('/users/me/sessions')
}

export interface UpdateSettingsInput {
  notifications_email?: boolean
  notifications_push?: boolean
  timezone?: string
}

export function updateSettings(input: UpdateSettingsInput): Promise<{ ok: boolean }> {
  return apiPatch<{ ok: boolean }>('/users/me/settings', input)
}

/** Смена пароля: после успеха прочие сессии отзываются, текущая живёт. */
export function changePassword(input: {
  current_password: string
  new_password: string
}): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/auth/change-password', input)
}
