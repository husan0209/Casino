/**
 * GAP-53: юнит-тесты casino.api.ts — контракты путей/методов против
 * casino.controller. apiGet передаёт второй аргумент как { params },
 * apiPost/apiDelete — (url, body); mock-и сбрасываются beforeEach, иначе
 * toHaveBeenCalledWith матчится к вызовам предыдущего теста.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedApi = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}

vi.mock('axios', () => ({
  default: {
    create: () => mockedApi,
  },
}))

const { fetchProviders, fetchRecentGames, fetchFavoriteGames, addFavorite, removeFavorite } =
  await import('../src/lib/api/casino.api')

function ok<T>(data: T): { data: { data: T } } {
  return { data: { data } }
}

beforeEach(() => {
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
})

describe('GAP-53 casino.api — контракты путей/методов', () => {
  it('fetchProviders → GET /casino/providers (snake_case поля)', async () => {
    mockedApi.get.mockResolvedValueOnce(
      ok([{ slug: 'pragmatic', name: 'Pragmatic Play', logo_url: null, game_count: 12, type: 'slots' }]),
    )
    const res = await fetchProviders()
    expect(mockedApi.get).toHaveBeenCalledWith('/casino/providers', { params: undefined })
    expect(res[0]?.game_count).toBe(12)
  })

  it('fetchRecentGames → GET /casino/recent', async () => {
    mockedApi.get.mockResolvedValueOnce(ok([]))
    await fetchRecentGames()
    expect(mockedApi.get).toHaveBeenCalledWith('/casino/recent', { params: undefined })
  })

  it('fetchFavoriteGames → GET /casino/favorites с per_page', async () => {
    mockedApi.get.mockResolvedValueOnce(ok({ data: [], meta: { page: 1 } }))
    await fetchFavoriteGames(2, 48)
    expect(mockedApi.get).toHaveBeenCalledWith('/casino/favorites', {
      params: { page: 2, per_page: 48 },
    })
  })

  it('addFavorite → POST /casino/games/:slug/favorite', async () => {
    mockedApi.post.mockResolvedValueOnce(ok({ ok: true }))
    await addFavorite('sweet-bonanza')
    expect(mockedApi.post).toHaveBeenCalledWith('/casino/games/sweet-bonanza/favorite', undefined)
  })

  it('removeFavorite → DELETE /casino/games/:slug/favorite', async () => {
    mockedApi.delete.mockResolvedValueOnce(ok({ ok: true }))
    await removeFavorite('sweet-bonanza')
    expect(mockedApi.delete).toHaveBeenCalledWith('/casino/games/sweet-bonanza/favorite')
  })
})
