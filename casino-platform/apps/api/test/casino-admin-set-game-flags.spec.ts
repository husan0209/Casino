/**
 * Юнит-тесты AdminSetGameFlagsUseCase (G21, В3).
 *
 * Четыре endpoint'а каталога (enable/disable/feature/unfeature) сводятся к
 * одному действию. Главное, что проверяем: переданный флаг пишется, а
 * непереданный — НЕ попадает в Prisma (иначе витрина теряла бы соседний флаг).
 */
import { AdminSetGameFlagsUseCase } from '../src/modules/casino/application/use-cases/admin-set-game-flags.use-case'

import type { IGameCatalogRepository } from '../src/modules/casino/domain/repositories/casino.repository'

type UpdateCall = { id: string; data: Record<string, unknown> }

function makeCatalog(updateImpl?: (id: string, data: Record<string, unknown>) => Promise<void>): {
  catalog: IGameCatalogRepository
  calls: UpdateCall[]
} {
  const calls: UpdateCall[] = []
  const catalog = {
    updateGame:
      updateImpl ??
      (async (id: string, data: Record<string, unknown>): Promise<void> => {
        calls.push({ id, data })
      }),
  }
  return { catalog: catalog as unknown as IGameCatalogRepository, calls }
}

describe('AdminSetGameFlagsUseCase', () => {
  it('enable: в порт идёт только isEnabled, ключа isFeatured нет вовсе', async () => {
    const { catalog, calls } = makeCatalog()

    const res = await new AdminSetGameFlagsUseCase(catalog).execute('game-1', { isEnabled: true })

    expect(res).toEqual({ ok: true })
    expect(calls).toEqual([{ id: 'game-1', data: { isEnabled: true } }])
    expect('isFeatured' in calls[0]!.data).toBe(false)
  })

  it('unfeature: снимается только isFeatured', async () => {
    const { catalog, calls } = makeCatalog()

    await new AdminSetGameFlagsUseCase(catalog).execute('game-2', { isFeatured: false })

    expect(calls).toEqual([{ id: 'game-2', data: { isFeatured: false } }])
  })

  it('краевой случай: false пишется явно (не путается с «флаг не передан»)', async () => {
    const { catalog, calls } = makeCatalog()

    await new AdminSetGameFlagsUseCase(catalog).execute('game-3', {
      isEnabled: false,
      isFeatured: true,
    })

    expect(calls[0]!.data).toEqual({ isEnabled: false, isFeatured: true })
  })

  it('пустой набор флагов — в Prisma уходит пустой объект (никаких случайных колонок)', async () => {
    const { catalog, calls } = makeCatalog()

    await new AdminSetGameFlagsUseCase(catalog).execute('game-4', {})

    expect(calls).toEqual([{ id: 'game-4', data: {} }])
  })

  it('отказ порта (update упал) — ошибка пробрасывается наружу', async () => {
    const { catalog } = makeCatalog(async () => {
      throw new Error('db down')
    })

    await expect(
      new AdminSetGameFlagsUseCase(catalog).execute('game-5', { isEnabled: true }),
    ).rejects.toThrow('db down')
  })
})
