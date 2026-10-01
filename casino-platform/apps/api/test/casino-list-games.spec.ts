import { ListGamesUseCase } from '../src/modules/casino/application/use-cases/list-games.use-case'

import type { IGameCatalogRepository } from '../src/modules/casino/domain/repositories/casino.repository'

function makeCatalog(): { catalog: IGameCatalogRepository; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  const catalog: IGameCatalogRepository = {
    findMany: async () =>
      [[{ id: 'g1', slug: 'sweet-bonanza', name: 'Sweet Bonanza' }], 1] as never,
    count: async () => 1,
  } as unknown as IGameCatalogRepository
  return {
    catalog: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push(args)
        return (await catalog.findMany(args as never)) as never
      },
      count: async (args: Record<string, unknown>) => {
        calls.push(args)
        return 1
      },
    } as unknown as IGameCatalogRepository,
    calls,
  }
}

describe('ListGamesUseCase', () => {
  it('дефолты: страница 1, perPage 24; catalog.findMany получает skip=0/take=24', async () => {
    const { catalog, calls } = makeCatalog()
    const uc = new ListGamesUseCase(catalog)
    const res = await uc.execute({})
    expect(res.meta.page).toBe(1)
    expect(res.meta.perPage).toBe(24)
    expect(res.meta.total).toBe(1)
    const findMany = calls.find((c) => 'skip' in c && 'take' in c)
    expect(findMany).toMatchObject({ skip: 0, take: 24 })
  })

  it('page=3, per_page=50 → skip=(3-1)*50, take=50', async () => {
    const { catalog, calls } = makeCatalog()
    const uc = new ListGamesUseCase(catalog)
    await uc.execute({ page: '3', per_page: '50' })
    const findMany = calls.find((c) => 'skip' in c && 'take' in c)
    expect(findMany).toMatchObject({ skip: 100, take: 50 })
  })

  it('per_page=500 клампится до 100', async () => {
    const { catalog, calls } = makeCatalog()
    const uc = new ListGamesUseCase(catalog)
    await uc.execute({ page: '1', per_page: '500' })
    const findMany = calls.find((c) => 'skip' in c && 'take' in c)
    expect(findMany).toMatchObject({ skip: 0, take: 100 })
  })

  it('мусор в page/per_page → дефолты (1/24), не NaN', async () => {
    const { catalog, calls } = makeCatalog()
    const uc = new ListGamesUseCase(catalog)
    const res = await uc.execute({ page: 'abc', per_page: 'xyz' })
    expect(res.meta.page).toBe(1)
    expect(res.meta.perPage).toBe(24)
    const findMany = calls.find((c) => 'skip' in c && 'take' in c)
    expect(findMany).toMatchObject({ skip: 0, take: 24 })
  })
})
