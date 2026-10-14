/**
 * Демо-состояние Plinko (`GET /plinko/:token/state`).
 *
 * Ловит то, что не видно в спеках use-case: экран остатка собирается в
 * контроллере. Токен демо живёт в URL игры, поэтому после F5 состояние обязано
 * отдать тот же счёт, с которого `POST /drop` списывает ставку, — иначе игрок
 * видит 1000 и ставит с них, а сервер отвечает INSUFFICIENT_FUNDS.
 */
import { describe, expect, it, vi } from 'vitest'

import { type OriginalsSessionLoader } from '../src/modules/casino/application/use-cases/originals-session-loader'
import { TIGER_DEMO_START_CREDIT } from '../src/modules/casino/application/use-cases/originals-session.use-case'
import { type PlinkoDropUseCase } from '../src/modules/casino/application/use-cases/plinko-drop.use-case'
import { type IDemoBalanceStore } from '../src/modules/casino/domain/demo-balance'
import { PlinkoController } from '../src/modules/casino/presentation/controllers/plinko.controller'
import { type WalletFacade } from '../src/modules/wallet/facade/wallet.facade'

const DEMO_TOKEN = 'demo_plinko_0f2b9c1e4a7d6835b1c0e9f8a7b6c5d4'

function makeController(fakes: { stored?: string | null; realSession?: boolean } = {}) {
  const peek = vi.fn(async (): Promise<string> => fakes.stored ?? TIGER_DEMO_START_CREDIT)
  const demoBalance = { peek, settle: vi.fn() } as unknown as IDemoBalanceStore
  const getBalance = vi.fn(async () => ({ available: '77.00', locked: '0.00' }))
  const wallet = { getBalance } as unknown as WalletFacade
  const loadActiveHouseSession = vi.fn(async () =>
    fakes.realSession === false
      ? (null as never)
      : ({ userId: 'u-1', currency: 'RUB', game: { minBet: null, maxBet: null } } as never),
  )
  const sessionLoader = {
    isDemoToken: (token: string) => token.startsWith('demo_'),
    loadActiveHouseSession,
  } as unknown as OriginalsSessionLoader
  const resolvePack = vi.fn(async () => ({ low: [1], medium: [1], high: [1] }) as never)
  const dropUseCase = { resolvePack } as unknown as PlinkoDropUseCase

  /* `@Res()`: контроллер сериализует сам, глобальный фильтр мимо него. */
  const json = vi.fn((body: unknown) => body)
  const status = vi.fn(() => ({ json }))
  const response = { json, status } as never

  const controller = new PlinkoController(dropUseCase, sessionLoader, wallet, demoBalance)
  return { controller, json, peek, getBalance, response, status }
}

describe('GET /plinko/:token/state — демо', () => {
  it('отдаёт наигранный остаток счёта, а не константу старта', async () => {
    const { controller, json, peek, response } = makeController({ stored: '640.50' })

    await controller.state(DEMO_TOKEN, response)

    expect(peek).toHaveBeenCalledWith(DEMO_TOKEN, TIGER_DEMO_START_CREDIT)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ balance: '640.50', demo: true }),
      }),
    )
  })

  it('без сыгранного счёта стартует с демо-кредита тем же значением, что списывает /drop', async () => {
    const { controller, json, peek, response } = makeController()

    await controller.state(DEMO_TOKEN, response)

    expect(peek).toHaveBeenCalledWith(DEMO_TOKEN, TIGER_DEMO_START_CREDIT)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ balance: TIGER_DEMO_START_CREDIT }),
      }),
    )
  })

  it('боевая сессия читает кошелёк и не трогает демо-счёт', async () => {
    const { controller, json, peek, getBalance, response } = makeController({ realSession: true })

    await controller.state('sess_real_token', response)

    expect(peek).not.toHaveBeenCalled()
    expect(getBalance).toHaveBeenCalledWith('u-1', 'RUB')
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ balance: '77.00', demo: false }),
      }),
    )
  })
})
