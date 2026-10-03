/**
 * Юнит-тесты AdminSyncProviderGamesUseCase (G21, В3).
 *
 * Синхронизация каталога (UC-GAME-19) — самые «толстые» из вынесенных из
 * контроллера записей: здесь проверяются правила «новую игру создаём
 * ВЫКЛЮЧЕННОЙ», slug из доменного value-object, нормализация строк провайдера
 * и перезапись счётчика gameCount по итогам синхронизации.
 */
import { AdminSyncProviderGamesUseCase } from '../src/modules/casino/application/use-cases/admin-sync-provider-games.use-case'
import { CasinoEntityNotFoundError } from '../src/modules/casino/domain/errors'
import { gameSlug } from '../src/modules/casino/domain/value-objects/game-slug'

import type { IProviderAdapterFactory } from '../src/modules/casino/domain/casino.ports'
import type { ProviderGameRow } from '../src/modules/casino/domain/provider-adapter.interface'
import type {
  IGameCatalogRepository,
  IGameProviderRepository,
} from '../src/modules/casino/domain/repositories/casino.repository'

type CreatedRow = Record<string, unknown>
type UpdatedRow = { id: string; data: Record<string, unknown> }

function makeDeps(input: {
  provider?: { id: string; slug: string } | null
  rows?: ProviderGameRow[]
  existing?: Record<string, string>
  total?: number
  createImpl?: (data: CreatedRow) => Promise<never>
}) {
  const created: CreatedRow[] = []
  const updated: UpdatedRow[] = []
  const gameCountWrites: Array<{ id: string; gameCount: number }> = []
  const adapterCalls: string[] = []

  const provider =
    input.provider === undefined ? { id: 'provider-1', slug: 'pragmatic' } : input.provider
  const rows = input.rows ?? []
  const existing = input.existing ?? {}

  const providers = {
    findById: async () => provider,
    setGameCount: async (id: string, gameCount: number): Promise<void> => {
      gameCountWrites.push({ id, gameCount })
    },
  } as unknown as IGameProviderRepository

  const catalog = {
    findByProviderAndExternalGameId: async (_providerId: string, externalGameId: string) =>
      existing[externalGameId] ? ({ id: existing[externalGameId] } as never) : null,
    createGame:
      input.createImpl ??
      (async (data: CreatedRow): Promise<never> => {
        created.push(data)
        return undefined as never
      }),
    updateGame: async (id: string, data: Record<string, unknown>): Promise<void> => {
      updated.push({ id, data })
    },
    count: async () => input.total ?? rows.length,
  } as unknown as IGameCatalogRepository

  const adapters = {
    getAdapter: (slug: string) => {
      adapterCalls.push(slug)
      return { fetchGameList: async () => rows } as never
    },
  } as unknown as IProviderAdapterFactory

  return { providers, catalog, adapters, created, updated, gameCountWrites, adapterCalls }
}

describe('AdminSyncProviderGamesUseCase', () => {
  it('смешанный каталог: существующая игра правится, новая создаётся ВЫКЛЮЧЕННОЙ, gameCount перезаписан', async () => {
    const deps = makeDeps({
      rows: [
        {
          externalGameId: 'starb',
          name: 'Starburst',
          hasDemo: true,
          type: 'slot',
          category: 'slots',
        },
        { externalGameId: 'gonzo', name: 'Gonzo Quest', hasDemo: false },
      ],
      existing: { starb: 'game-old' },
      total: 42,
    })
    const uc = new AdminSyncProviderGamesUseCase(deps.providers, deps.catalog, deps.adapters)

    const res = await uc.execute('provider-1')

    expect(res).toEqual({
      added: 1,
      updated: 1,
      total: 42,
      note: 'Новые игры добавлены выключенными — включите нужные в разделе «Игры»',
    })
    expect(deps.updated).toEqual([
      {
        id: 'game-old',
        data: {
          name: 'Starburst',
          type: 'slot',
          category: 'slots',
          thumbnailUrl: null,
          hasDemo: true,
          rtp: null,
          metadata: {},
        },
      },
    ])
    // UC-GAME-19: новая игра всегда isEnabled=false, slug — доменное правило.
    expect(deps.created).toHaveLength(1)
    expect(deps.created[0]).toMatchObject({
      externalGameId: 'gonzo',
      providerId: 'provider-1',
      isEnabled: false,
      slug: gameSlug('pragmatic', 'gonzo', 'Gonzo Quest'),
    })
    expect(deps.gameCountWrites).toEqual([{ id: 'provider-1', gameCount: 42 }])
    expect(deps.adapterCalls).toEqual(['pragmatic'])
  })

  it('провайдер не найден → CasinoEntityNotFoundError (404 NOT_FOUND), ни одной записи', async () => {
    const deps = makeDeps({ provider: null })
    const uc = new AdminSyncProviderGamesUseCase(deps.providers, deps.catalog, deps.adapters)

    const error = await uc.execute('ghost').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CasinoEntityNotFoundError)
    expect((error as CasinoEntityNotFoundError).code).toBe('NOT_FOUND')
    expect((error as CasinoEntityNotFoundError).httpStatus).toBe(404)
    expect(deps.adapterCalls).toEqual([])
    expect(deps.created).toEqual([])
    expect(deps.updated).toEqual([])
    expect(deps.gameCountWrites).toEqual([])
  })

  it('краевой случай нормализации: имя по externalGameId, дефолты type/category, rtp — строкой', async () => {
    const deps = makeDeps({
      rows: [{ externalGameId: 'xyz', name: '', hasDemo: true, rtp: 96.5 }],
    })
    const uc = new AdminSyncProviderGamesUseCase(deps.providers, deps.catalog, deps.adapters)

    await uc.execute('provider-1')

    expect(deps.created[0]).toMatchObject({
      name: 'xyz',
      type: 'slot',
      category: 'slots',
      // G20: десятичное значение уходит в Prisma строкой, не number
      rtp: '96.5',
    })
  })

  it('отказ порта (createGame упал) — ошибка пробрасывается, gameCount не перезаписывается', async () => {
    const deps = makeDeps({
      rows: [{ externalGameId: 'boom', name: 'Boom', hasDemo: false }],
      createImpl: async () => {
        throw new Error('db down')
      },
    })
    const uc = new AdminSyncProviderGamesUseCase(deps.providers, deps.catalog, deps.adapters)

    await expect(uc.execute('provider-1')).rejects.toThrow('db down')
    expect(deps.gameCountWrites).toEqual([])
  })

  it('доменный slug: одна и та же пара (provider, externalId) даёт стабильное имя, разные провайдеры — разные slug', () => {
    const first = gameSlug('pragmatic', 'starb', 'Starburst')
    const again = gameSlug('pragmatic', 'starb', 'Starburst')
    const otherProvider = gameSlug('evolution', 'starb', 'Starburst')

    expect(again).toBe(first)
    expect(first.startsWith('starburst-')).toBe(true)
    expect(otherProvider).not.toBe(first)
  })
})
