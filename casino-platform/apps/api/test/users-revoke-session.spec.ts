/**
 * Юнит-тесты RevokeSessionUseCase (G21).
 *
 * Правила: текущую сессию отзывать нельзя (для этого logout); сессия,
 * не принадлежащая юзеру, для него «не найдена» (revoke вернул false).
 */
import { RevokeSessionUseCase } from '../src/modules/users/application/use-cases/revoke-session.use-case'

import type { IUserSessionRepository } from '../src/modules/users/domain/repositories/user-session.repository'

function makeDeps(over: { revokeResult?: boolean } = {}) {
  const got: Array<{ sessionId: string; userId: string }> = []
  const repo = {
    list: async () => [],
    revoke: async (sessionId: string, userId: string) => {
      got.push({ sessionId, userId })
      return over.revokeResult ?? true
    },
    revokeAllExceptCurrent: async () => 0,
  } as unknown as IUserSessionRepository
  return { repo, got }
}

describe('RevokeSessionUseCase', () => {
  it('чужую (не текущую) свою сессию отзывает: revoke(sessionId, userId), ok', async () => {
    const { repo, got } = makeDeps()
    const res = await new RevokeSessionUseCase(repo).execute('u-1', 'sess-2', 'sess-1')

    expect(res).toEqual({ ok: true })
    expect(got).toEqual([{ sessionId: 'sess-2', userId: 'u-1' }])
  })

  it('попытка отозвать текущую сессию → SessionRevokeForbiddenError, репозиторий не трогается', async () => {
    const { repo, got } = makeDeps()
    await expect(
      new RevokeSessionUseCase(repo).execute('u-1', 'sess-1', 'sess-1'),
    ).rejects.toThrow('Cannot revoke current session, use logout')
    expect(got).toHaveLength(0)
  })

  it('сессия не найдена / чужая → SessionRevokeForbiddenError (revoke вернул false)', async () => {
    const { repo } = makeDeps({ revokeResult: false })
    await expect(new RevokeSessionUseCase(repo).execute('u-1', 'sess-9', 'sess-1')).rejects.toThrow(
      'NOT_FOUND',
    )
  })

  it('отказ порта (revoke бросил) — ошибка пробрасывается', async () => {
    const repo = {
      revoke: async () => {
        throw new Error('db down')
      },
      revokeAllExceptCurrent: async () => 0,
    } as unknown as IUserSessionRepository
    await expect(new RevokeSessionUseCase(repo).execute('u-1', 'sess-2')).rejects.toThrow('db down')
  })
})
