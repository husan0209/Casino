/**
 * Юнит-тесты AdminUpdateGameUseCase (G21, В3).
 *
 * Проверяется маппинг PATCH /admin/games/:id: snake_case запроса → колонки
 * Prisma, «не передано — не пишем», и исторический quirk GAP-21 (isPopular сам
 * по себе не пишется), который репозиторий-порт чинить не вправе — контракт.
 */
import { AdminUpdateGameUseCase } from '../src/modules/casino/application/use-cases/admin-update-game.use-case'

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

describe('AdminUpdateGameUseCase', () => {
  it('полный набор полей: snake_case → camelCase-колонки', async () => {
    const { catalog, calls } = makeCatalog()

    const res = await new AdminUpdateGameUseCase(catalog).execute('game-1', {
      name_ru: 'Сладкая бонанза',
      is_new: true,
      is_popular: false,
      sort_order: 12,
      tags: ['jackpot', ' Megaways '],
    })

    expect(res).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        id: 'game-1',
        data: {
          nameRu: 'Сладкая бонанза',
          isNew: true,
          isPopular: false,
          sortOrder: 12,
          tags: ['jackpot', ' Megaways '],
        },
      },
    ])
  })

  it('частичное обновление: переданное поле пишется, остальные ключей нет', async () => {
    const { catalog, calls } = makeCatalog()

    await new AdminUpdateGameUseCase(catalog).execute('game-2', { name_ru: 'Новое имя' })

    expect(calls[0]!.data).toEqual({ nameRu: 'Новое имя' })
    expect(Object.keys(calls[0]!.data)).toEqual(['nameRu'])
  })

  it('краевой случай (квирк GAP-21): один isPopular не пишет ничего — ждём is_popular', async () => {
    const { catalog, calls } = makeCatalog()

    await new AdminUpdateGameUseCase(catalog).execute('game-3', { isPopular: true })

    expect(calls[0]!.data).toEqual({})
  })

  it('is_popular + isPopular: переопределение isPopular побеждает, false не теряется', async () => {
    const { catalog, calls } = makeCatalog()

    await new AdminUpdateGameUseCase(catalog).execute('game-4', {
      is_popular: false,
      isPopular: true,
    })

    expect(calls[0]!.data).toEqual({ isPopular: true })
  })

  it('sort_order=0 пишется (0 — валидный порядок, а не «поле не задано»)', async () => {
    const { catalog, calls } = makeCatalog()

    await new AdminUpdateGameUseCase(catalog).execute('game-5', { sort_order: 0 })

    expect(calls[0]!.data).toEqual({ sortOrder: 0 })
  })

  it('отказ порта (update упал) — ошибка пробрасывается, ok не возвращается', async () => {
    const { catalog } = makeCatalog(async () => {
      throw new Error('db down')
    })

    await expect(
      new AdminUpdateGameUseCase(catalog).execute('game-6', { name_ru: 'x' }),
    ).rejects.toThrow('db down')
  })
})
