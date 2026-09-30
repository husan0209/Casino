import { randomBytes } from 'crypto'

import { LaunchGameUseCase } from '../src/modules/casino/application/use-cases/launch-game.use-case'
import { GameDisabledError, GameNotFoundError, ProviderDisabledError } from '../src/modules/casino/domain/errors'
import type { IProviderAdapterFactory } from '../src/modules/casino/domain/casino.ports'
import type { IGameCatalogRepository, IGamePlayRepository } from '../src/modules/casino/domain/repositories/casino.repository'
import type { WalletFacade } from '../src/modules/wallet/facade/wallet.facade'

function makeGame(over: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    slug: 'sweet-bonanza',
    externalGameId: 'ext-1',
    isEnabled: true,
    supportedCurrencies: null,
    provider: { slug: 'demo-provider', isEnabled: true, config: null },
    ...over,
  } as never
}

function makeUc(game: unknown, adapterUrl = 'https://launch.example') {
  const getLaunchUrlCalls: unknown[] = []
  const catalog = { findBySlug: async () => game } as unknown as IGameCatalogRepository
  const adapters = {
    getAdapter: () => ({
      getLaunchUrl: async (params: unknown) => {
        getLaunchUrlCalls.push(params)
        return { url: adapterUrl }
      },
    }),
  } as unknown as IProviderAdapterFactory
  const wallet = { runInTransaction: (fn: () => unknown) => fn() } as unknown as WalletFacade
  const play = {} as unknown as IGamePlayRepository
  return {
    uc: new LaunchGameUseCase(adapters, wallet, catalog, play),
    getLaunchUrlCalls,
  }
}

const input = (over: Record<string, unknown> = {}) =>
  ({
    gameSlug: 'sweet-bonanza',
    userId: undefined,
    currency: 'RUB',
    isDemo: true,
    returnUrl: 'https://casino.local/return',
    ...over,
  }) as never

describe('LaunchGameUseCase', () => {
  it('игра не найдена → GameNotFoundError', async () => {
    const { uc } = makeUc(null)
    await expect(uc.execute(input())).rejects.toBeInstanceOf(GameNotFoundError)
  })

  it('реальная игра выключена (isDemo=false) → GameDisabledError', async () => {
    const { uc } = makeUc(makeGame({ isEnabled: false }))
    await expect(uc.execute(input({ isDemo: false, userId: 'user-1' }))).rejects.toBeInstanceOf(
      GameDisabledError,
    )
  })

  it('провайдер выключен → ProviderDisabledError', async () => {
    const { uc } = makeUc(makeGame({ provider: { slug: 'demo-provider', isEnabled: false, config: null } }))
    await expect(uc.execute(input())).rejects.toBeInstanceOf(ProviderDisabledError)
  })

  it('демо-запуск: сессии нет (session_id=null), адаптер получает demo-токен и returnUrl', async () => {
    const { uc, getLaunchUrlCalls } = makeUc(makeGame())
    const res = await uc.execute(input())
    expect(res.session_id).toBeNull()
    expect(res.launch_url).toBe('https://launch.example')
    expect(res.currency).toBe('RUB')
    const p = getLaunchUrlCalls[0] as { isDemo: boolean; sessionToken: string; returnUrl: string }
    expect(p.isDemo).toBe(true)
    expect(p.sessionToken).toMatch(/^demo_[0-9a-f]+/)
    expect(p.returnUrl).toBe('https://casino.local/return')
  })
})
