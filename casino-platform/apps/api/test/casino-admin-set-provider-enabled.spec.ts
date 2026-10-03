/**
 * Юнит-тесты AdminSetProviderEnabledUseCase (G21, В3).
 *
 * Порт IGameProviderRepository — единственный, у кого есть право писать
 * isEnabled в game_providers; раньше update'ы шли прямо из контроллера.
 */
import { AdminSetProviderEnabledUseCase } from '../src/modules/casino/application/use-cases/admin-set-provider-enabled.use-case'

import type { IGameProviderRepository } from '../src/modules/casino/domain/repositories/casino.repository'

type EnabledCall = { id: string; isEnabled: boolean }

function makeProviderRepo(setEnabledImpl?: (id: string, isEnabled: boolean) => Promise<void>): {
  repo: IGameProviderRepository
  calls: EnabledCall[]
} {
  const calls: EnabledCall[] = []
  const repo = {
    setEnabled:
      setEnabledImpl ??
      (async (id: string, isEnabled: boolean): Promise<void> => {
        calls.push({ id, isEnabled })
      }),
  }
  return { repo: repo as unknown as IGameProviderRepository, calls }
}

describe('AdminSetProviderEnabledUseCase', () => {
  it('enable: флажок isEnabled=true уходит в порт, ответ — { ok: true }', async () => {
    const { repo, calls } = makeProviderRepo()

    const res = await new AdminSetProviderEnabledUseCase(repo).execute('provider-1', true)

    expect(res).toEqual({ ok: true })
    expect(calls).toEqual([{ id: 'provider-1', isEnabled: true }])
  })

  it('disable: то же действие с false — флаг пишется, а не снимается молча', async () => {
    const { repo, calls } = makeProviderRepo()

    await new AdminSetProviderEnabledUseCase(repo).execute('provider-2', false)

    expect(calls).toEqual([{ id: 'provider-2', isEnabled: false }])
  })

  it('отказ порта (update упал) — ошибка пробрасывается, ok не возвращается', async () => {
    const { repo } = makeProviderRepo(async () => {
      throw new Error('P2025: record not found')
    })

    await expect(new AdminSetProviderEnabledUseCase(repo).execute('ghost', true)).rejects.toThrow(
      'P2025: record not found',
    )
  })
})
