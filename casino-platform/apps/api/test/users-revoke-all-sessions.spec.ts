/**
 * Юнит-тесты RevokeAllSessionsUseCase (G21, GAP-52).
 *
 * «Завершить все кроме текущей»: currentSessionId уходит в репозиторий
 * как except-аргумент — пользователь не разлогинивается сам собой.
 */
import { RevokeAllSessionsUseCase } from '../src/modules/users/application/use-cases/revoke-all-sessions.use-case'
import type { IUserSessionRepository } from '../src/modules/users/domain/repositories/user-session.repository'

describe('RevokeAllSessionsUseCase', () => {
  it('revokeAllExceptCurrent(userId, currentSessionId) вызван, число отозванных возвращено', async () => {
    const got: Array<{ userId: string; except: string }> = []
    const repo = {
      revokeAllExceptCurrent: async (userId: string, except: string) => {
        got.push({ userId, except })
        return 3
      },
    } as unknown as IUserSessionRepository

    const res = await new RevokeAllSessionsUseCase(repo).execute('u-1', 'sess-current')

    expect(got).toEqual([{ userId: 'u-1', except: 'sess-current' }])
    expect(res).toEqual({ ok: true, revoked: 3 })
  })

  it('отзывать нечего: revoked = 0, ok:true', async () => {
    const repo = {
      revokeAllExceptCurrent: async () => 0,
    } as unknown as IUserSessionRepository
    const res = await new RevokeAllSessionsUseCase(repo).execute('u-1', 'sess-current')
    expect(res).toEqual({ ok: true, revoked: 0 })
  })

  it('отказ порта (revokeAllExceptCurrent бросил) — ошибка пробрасывается', async () => {
    const repo = {
      revokeAllExceptCurrent: async () => {
        throw new Error('db down')
      },
    } as unknown as IUserSessionRepository
    await expect(
      new RevokeAllSessionsUseCase(repo).execute('u-1', 'sess-current'),
    ).rejects.toThrow('db down')
  })
})
