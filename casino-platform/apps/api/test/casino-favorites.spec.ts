import { FavoritesUseCase } from '../src/modules/casino/application/use-cases/favorites.use-case'
import { GameNotFoundError } from '../src/modules/casino/domain/errors'
import type { IGameCatalogRepository, IGameFavoritesRepository } from '../src/modules/casino/domain/repositories/casino.repository'

const game = { id: 'g1', slug: 'sweet-bonanza' }

function makePorts(gameExists: boolean) {
  const upserts: Array<{ userId: string; gameId: string }> = []
  const catalog = {
    findBySlug: async (slug: string) => (gameExists ? { ...game, slug } : null),
  } as unknown as IGameCatalogRepository
  const favorites = {
    upsert: async (userId: string, gameId: string) => {
      upserts.push({ userId, gameId })
    },
  } as unknown as IGameFavoritesRepository
  return { uc: new FavoritesUseCase(catalog, favorites), upserts }
}

describe('FavoritesUseCase.add', () => {
  it('игра не найдена → GameNotFoundError, upsert не вызывается', async () => {
    const { uc, upserts } = makePorts(false)
    await expect(uc.add('user-1', 'no-such-game')).rejects.toBeInstanceOf(GameNotFoundError)
    expect(upserts).toHaveLength(0)
  })

  it('игра найдена → favorites.upsert(userId, gameId)', async () => {
    const { uc, upserts } = makePorts(true)
    const res = await uc.add('user-1', 'sweet-bonanza')
    expect(res).toEqual({ ok: true })
    expect(upserts).toEqual([{ userId: 'user-1', gameId: 'g1' }])
  })

  it('повторное добавление — upsert идемпотентен по себе (двойной вызов не падает)', async () => {
    const { uc, upserts } = makePorts(true)
    await uc.add('user-1', 'sweet-bonanza')
    await uc.add('user-1', 'sweet-bonanza')
    expect(upserts).toHaveLength(2)
  })
})
