/**
 * GAP-52: юнит-тесты API-модуля профиля (users.api.ts) — контракт путей
 * и методов против users.controller / auth.controller (не мокаем axios —
 * перехватываем axios-инстанс, как api-errors.spec.ts).
 */
import { describe, expect, it, vi } from 'vitest'

const mockedApi = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}

vi.mock('axios', () => ({
  default: {
    create: () => mockedApi,
  },
}))

const { listSessions, revokeSession, revokeAllSessions, changePassword, updateSettings } =
  await import('../src/lib/api/users.api')

function ok<T>(data: T): { data: { data: T } } {
  return { data: { data } }
}

describe('GAP-52 users.api — контракты путей/методов', () => {
  it('listSessions → GET /users/me/sessions', async () => {
    mockedApi.get.mockResolvedValueOnce(
      ok([{ id: 's1', isCurrent: true, createdAt: '2026-01-01', ipAddress: '1.2.3.4', userAgent: 'iPhone' }]),
    )
    const res = await listSessions()
    expect(mockedApi.get).toHaveBeenCalledWith('/users/me/sessions', { params: undefined })
    expect(res[0]?.id).toBe('s1')
  })

  it('revokeSession → DELETE /users/me/sessions/:id', async () => {
    mockedApi.delete.mockResolvedValueOnce(ok({ ok: true }))
    await revokeSession('s2')
    expect(mockedApi.delete).toHaveBeenCalledWith('/users/me/sessions/s2')
  })

  it('revokeAllSessions → DELETE /users/me/sessions (все кроме текущей)', async () => {
    mockedApi.delete.mockResolvedValueOnce(ok({ ok: true, revoked: 3 }))
    const res = await revokeAllSessions()
    expect(mockedApi.delete).toHaveBeenCalledWith('/users/me/sessions')
    expect(res.revoked).toBe(3)
  })

  it('changePassword → POST /auth/change-password, snake_case body', async () => {
    mockedApi.post.mockResolvedValueOnce(ok({ ok: true }))
    await changePassword({ current_password: 'a', new_password: 'b12345678' })
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/change-password', {
      current_password: 'a',
      new_password: 'b12345678',
    })
  })

  it('updateSettings → PATCH /users/me/settings с timezone', async () => {
    mockedApi.patch.mockResolvedValueOnce(ok({ ok: true }))
    await updateSettings({ timezone: 'Europe/Kiev', notifications_email: false })
    expect(mockedApi.patch).toHaveBeenCalledWith('/users/me/settings', {
      timezone: 'Europe/Kiev',
      notifications_email: false,
    })
  })
})
