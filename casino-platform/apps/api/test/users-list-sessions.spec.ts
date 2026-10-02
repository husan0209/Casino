/**
 * Юнит-тесты ListSessionsUseCase (G21).
 *
 * К списку сессий добавляется флаг isCurrent (сравнение с текущей сессией);
 * без currentSessionId все сессии помечаются как чужие.
 */
import { ListSessionsUseCase } from '../src/modules/users/application/use-cases/list-sessions.use-case'
import type { IUserSessionRepository } from '../src/modules/users/domain/repositories/user-session.repository'

function sessionRow(over: { id?: string; ipAddress?: string | null; userAgent?: string | null } = {}) {
  return {
    id: over.id ?? 'sess-1',
    ipAddress: over.ipAddress ?? '10.0.0.1',
    userAgent: over.userAgent ?? 'vitest',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

describe('ListSessionsUseCase', () => {
  it('isCurrent расставляется по currentSessionId', async () => {
    const repo = {
      list: async () => [sessionRow({ id: 'sess-1' }), sessionRow({ id: 'sess-2' })],
    } as unknown as IUserSessionRepository

    const res = await new ListSessionsUseCase(repo).execute('u-1', 'sess-2')

    expect(res).toHaveLength(2)
    expect(res.find((s) => s.id === 'sess-1')!.isCurrent).toBe(false)
    expect(res.find((s) => s.id === 'sess-2')!.isCurrent).toBe(true)
  })

  it('без currentSessionId ни одна сессия не текущая', async () => {
    const repo = {
      list: async () => [sessionRow()],
    } as unknown as IUserSessionRepository
    const res = await new ListSessionsUseCase(repo).execute('u-1')
    expect(res[0]!.isCurrent).toBe(false)
  })

  it('поля сессии сохраняются без изменений', async () => {
    const row = sessionRow({ id: 'sess-3', ipAddress: null, userAgent: null })
    const repo = { list: async () => [row] } as unknown as IUserSessionRepository
    const res = await new ListSessionsUseCase(repo).execute('u-1', 'sess-3')
    expect(res[0]).toEqual({ ...row, isCurrent: true })
  })

  it('отказ порта (list бросил) — ошибка пробрасывается', async () => {
    const repo = {
      list: async () => {
        throw new Error('db down')
      },
    } as unknown as IUserSessionRepository
    await expect(new ListSessionsUseCase(repo).execute('u-1')).rejects.toThrow('db down')
  })
})
