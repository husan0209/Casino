/**
 * Юнит-тесты LogoutUseCase (G21).
 *
 * Use-case тонкий: делегирует revoke в session-репозиторий. Проверяем
 * проброс вызова и то, что отказ порта не глотается.
 */
import { LogoutUseCase } from '../src/modules/auth/application/use-cases/logout.use-case'

import type { ISessionRepository } from '../src/modules/auth/domain/repositories/session.repository'

function makeSessions(over: { revokeError?: Error } = {}) {
  const revoked: string[] = []
  const sessions: ISessionRepository = {
    create: async () => {
      throw new Error('not expected in this spec')
    },
    findByRefreshTokenHash: async () => null,
    revoke: async (id) => {
      if (over.revokeError) throw over.revokeError
      revoked.push(id)
    },
    revokeAllUserSessions: async () => {},
    revokeAllUserSessionsExcept: async () => {},
  }
  return { sessions, revoked }
}

describe('LogoutUseCase', () => {
  it('revoke вызывается с id сессии, ответ ok', async () => {
    const { sessions, revoked } = makeSessions()
    const res = await new LogoutUseCase(sessions).execute('sess-42')
    expect(revoked).toEqual(['sess-42'])
    expect(res).toEqual({ ok: true })
  })

  it('отказ порта (revoke бросил) — ошибка пробрасывается наверх, не глотается', async () => {
    const { sessions } = makeSessions({ revokeError: new Error('db down') })
    await expect(new LogoutUseCase(sessions).execute('sess-42')).rejects.toThrow('db down')
  })
})
