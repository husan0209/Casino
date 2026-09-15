import { describe, expect, it, vi } from 'vitest'

import { FavoritesUseCase } from '../src/modules/casino/application/use-cases/favorites.use-case'
import {
  type IGameCatalogRepository,
  type IGameFavoritesRepository,
} from '../src/modules/casino/domain/repositories/casino.repository'

/**
 * GAP-55 (д): история ставок (§12) должна считаться ОДНИМ фильтром для списка,
 * счётчика и агрегатов. Иначе отдельная строка «ставок: 124» над отфильтрованной
 * таблицей врёт — классический расходящийся отчёт (WHERE собирается дважды и
 * разъезжается при добавлении нового фильтра).
 *
 * Decimal в моках не конструируется, чтобы тест не зависел от сгенерированного
 * Prisma-клиента: пустые `_sum` Prisma отдаёт как null → проверяем строку '0'.
 */
interface RepoSpy {
  findRoundsWithGame: ReturnType<typeof vi.fn>
  countRounds: ReturnType<typeof vi.fn>
  roundStats: ReturnType<typeof vi.fn>
}

function harness(): { useCase: FavoritesUseCase; spy: RepoSpy } {
  const spy: RepoSpy = {
    findRoundsWithGame: vi.fn().mockResolvedValue([]),
    countRounds: vi.fn().mockResolvedValue(0),
    roundStats: vi.fn().mockResolvedValue([
      { currency: 'RUB', rounds: 7, turnover: null, wins: null },
    ]),
  }
  const favorites = {
    upsert: vi.fn(),
    remove: vi.fn(),
    findFavorites: vi.fn(),
    countFavorites: vi.fn(),
    findRecentSessions: vi.fn(),
    ...spy,
  } as unknown as IGameFavoritesRepository
  const catalog = {
    findBySlug: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  } as unknown as IGameCatalogRepository
  return { useCase: new FavoritesUseCase(catalog, favorites), spy }
}

describe('GAP-55 history (§12): один фильтр на список/счётчик/агрегаты', () => {
  it('все три метода получают идентичный объект фильтра', async () => {
    const { useCase, spy } = harness()
    const from = new Date('2026-09-01T00:00:00.000Z')
    const to = new Date('2026-09-07T23:59:59.999Z')

    await useCase.history({
      userId: 'u1',
      page: 2,
      perPage: 20,
      providerSlug: 'pragmatic-play',
      currency: 'RUB',
      from,
      to,
    })

    const listFilter = spy.findRoundsWithGame.mock.calls[0][0]
    const countFilter = spy.countRounds.mock.calls[0][0]
    const statsFilter = spy.roundStats.mock.calls[0][0]
    // Один и тот же WHERE для всех трёх выборок; у списка — плюс пагинация
    expect(statsFilter).toEqual(countFilter)
    expect(listFilter).toEqual({ ...countFilter, skip: 20, take: 20 })
    expect(countFilter).toMatchObject({
      userId: 'u1',
      providerSlug: 'pragmatic-play',
      currency: 'RUB',
      from,
      to,
    })
  })

  it('пагинация не уезжает в счётчик и агрегаты (иначе total считается по всей истории)', async () => {
    const { useCase, spy } = harness()
    await useCase.history({ userId: 'u1', page: 3, perPage: 10 })
    expect(spy.countRounds.mock.calls[0][0]).not.toHaveProperty('skip')
    expect(spy.roundStats.mock.calls[0][0]).not.toHaveProperty('take')
  })

  it('пустые суммы groupBy → строка "0": деньги в API всегда string', async () => {
    const { useCase } = harness()
    const result = await useCase.history({ userId: 'u1', page: 1, perPage: 20 })
    expect(result.stats).toEqual([{ currency: 'RUB', rounds: 7, turnover: '0', wins: '0' }])
  })

  it('без фильтров уходят только userId/skip/take — пустые опции не проттекают ключами', async () => {
    const { useCase, spy } = harness()
    await useCase.history({ userId: 'u1', page: 1, perPage: 20 })
    expect(Object.keys(spy.findRoundsWithGame.mock.calls[0][0]).sort()).toEqual([
      'skip',
      'take',
      'userId',
    ])
  })
})
