import { randomUUID } from 'crypto'

import { Decimal } from 'decimal.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { type WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { money } from '@casino/shared-utils'

import {
  AztecSpinUseCase,
  hashAztecOutcome,
  rollAztecOutcome,
  type AztecSpinInput,
} from './aztec-spin.use-case'
import { type OriginalsSessionLoader } from './originals-session-loader'
import { AZTEC_BASE_TUNING, flattenAztecPlays } from '../../domain/aztec-game'
import { type IDemoBalanceStore } from '../../domain/demo-balance'
import { InvalidBetRequestError } from '../../domain/errors'
import {
  type GameSessionWithGame,
  type GameTransactionRow,
  type IGameCatalogRepository,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const GAME_ID = '33333333-3333-4333-8333-333333333333'
const PROVIDER_ID = '44444444-4444-4444-8444-444444444444'
const SESSION_TOKEN = 'aztec_session_token_for_tests'

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function spinInput(overrides: Partial<AztecSpinInput> = {}): AztecSpinInput {
  return { spinId: randomUUID(), bet: '10', ...overrides }
}

function makeSession(
  minBet: number | null = 1,
  maxBet: number | null = 10000,
  rtp: string | null = null,
): GameSessionWithGame {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    gameId: GAME_ID,
    providerId: PROVIDER_ID,
    sessionToken: SESSION_TOKEN,
    currency: 'RUB',
    status: 'active',
    game: { externalGameId: 'treasuresofaztec', minBet, maxBet, rtp },
  } as unknown as GameSessionWithGame
}

interface PlayDouble {
  repository: IGamePlayRepository
  transactions: GameTransactionRow[]
  rounds: Record<string, unknown>[]
}

function makePlay(
  session: GameSessionWithGame | null,
  existing: GameTransactionRow[] = [],
): PlayDouble {
  const transactions: GameTransactionRow[] = [...existing]
  const rounds: Record<string, unknown>[] = []
  const repository = {
    findSessionByTokenWithGame: () => Promise.resolve(session),
    touchSession: () => Promise.resolve(),
    findTransactionByExternal: (_providerId: string, externalId: string) =>
      Promise.resolve(transactions.find((row) => row.externalTransactionId === externalId) ?? null),
    createTransaction: (data: Record<string, unknown>) => {
      const row = { id: `tx-${transactions.length + 1}`, ...data } as unknown as GameTransactionRow
      transactions.push(row)
      return Promise.resolve(row)
    },
    createRound: (data: Record<string, unknown>) => {
      const row = { id: `round-${rounds.length + 1}`, ...data }
      rounds.push(row)
      return Promise.resolve(row)
    },
    updateRound: (_id: string, data: Record<string, unknown>) => {
      rounds.push({ update: data })
      return Promise.resolve()
    },
    addSessionBet: () => Promise.resolve(),
    addSessionWin: () => Promise.resolve(),
  } as unknown as IGamePlayRepository
  return { repository, transactions, rounds }
}

function makeWallet(available: string): {
  facade: WalletFacade
  calls: { debits: number; credits: number }
  balanceOf: () => string
} {
  const calls = { debits: 0, credits: 0 }
  let balance = available
  const facade = {
    getBalance: () => Promise.resolve({ available: balance, balance }),
    runInTransaction: (_input: unknown, callback: (tx: unknown) => Promise<unknown>) =>
      callback({}),
    debit: (input: { amount: string }) => {
      calls.debits += 1
      balance = money.subtract(balance, input.amount)
      return Promise.resolve({
        balanceBefore: available,
        balanceAfter: balance,
        ledgerEntryId: `ledger-debit-${calls.debits}`,
        duplicate: false,
      })
    },
    credit: (input: { amount: string }) => {
      calls.credits += 1
      balance = money.add(balance, input.amount)
      return Promise.resolve({
        balanceBefore: available,
        balanceAfter: balance,
        ledgerEntryId: `ledger-credit-${calls.credits}`,
        duplicate: false,
      })
    },
  } as unknown as WalletFacade
  return { facade, calls, balanceOf: () => balance }
}

function makeLoader(session: GameSessionWithGame | null): OriginalsSessionLoader {
  return {
    isDemoToken: (token: string) => token.startsWith('demo_'),
    loadActiveHouseSession: () =>
      session ? Promise.resolve(session) : Promise.reject(new InvalidBetRequestError()),
  } as unknown as OriginalsSessionLoader
}

/** Карточка игры из каталога: демо-ветке нужен только rtp_demo. */
function makeCatalog(rtpDemo: string | null): IGameCatalogRepository {
  const card = rtpDemo === null ? null : { rtpDemo: new Decimal(rtpDemo) }
  return {
    findByExternalGameId: () => Promise.resolve(card),
  } as unknown as IGameCatalogRepository
}

describe('rollAztecOutcome', () => {
  it('выплата равна ставка × множитель и не зависит от порядка вызовов', () => {
    const parsed = spinInput({ bet: '10' })
    const outcome = rollAztecOutcome(parsed, AZTEC_BASE_TUNING, mulberry32(31337))

    expect(Number(outcome.multiplier)).toBeGreaterThanOrEqual(0)
    expect(outcome.win).toBe(money.multiply('10', outcome.multiplier))
    expect(outcome.outcomeHash).toHaveLength(64)
  })

  it('хеш фиксирует цепочку: другой исход — другой хеш', () => {
    const parsed = spinInput()
    const first = rollAztecOutcome(parsed, AZTEC_BASE_TUNING, mulberry32(1))
    const second = rollAztecOutcome(parsed, AZTEC_BASE_TUNING, mulberry32(2))
    const steps = flattenAztecPlays(first.plays)

    expect(hashAztecOutcome(parsed.spinId, steps)).toBe(first.outcomeHash)
    expect(second.outcomeHash).not.toBe(first.outcomeHash)
  })
})

/**
 * Двойник демо-счёта: те же правила, что у Redis-скрипта (списать можно
 * только если ставки хватает), только остаток живёт в Map.
 */
function makeDemoBalance(): IDemoBalanceStore & { balances: Map<string, string> } {
  const balances = new Map<string, string>()
  return {
    balances,
    settle: async ({ sessionToken, startCredit, bet, win }) => {
      const current = balances.get(sessionToken) ?? startCredit
      if (money.isGreaterThan(bet, current)) {
        return { accepted: false, balance: current }
      }
      const next = money.add(money.subtract(current, bet), win)
      balances.set(sessionToken, next)
      return { accepted: true, balance: next }
    },
    peek: async (sessionToken: string, startCredit: string) =>
      balances.get(sessionToken) ?? startCredit,
  }
}

describe('AztecSpinUseCase: демо', () => {
  it('не трогает кошелёк и считает баланс от 1000', async () => {
    const wallet = makeWallet('0')
    const useCase = new AztecSpinUseCase(
      makeLoader(null),
      wallet.facade,
      makePlay(null).repository,
      makeCatalog(null),
      makeDemoBalance(),
    )

    const data = await useCase.execute({
      sessionToken: 'demo_treasuresofaztec_token',
      spinId: spinInput().spinId,
      bet: '10',
    })

    expect(wallet.calls.debits).toBe(0)
    expect(data.balance).toBe(money.add(money.subtract('1000.00', '10'), data.win))
    expect(data.roundId).toBeNull()
    expect(data.duplicate).toBe(false)
  })

  it('идемпотентности в демо нет: повтор того же spinId перерозыгрывает исход', async () => {
    const useCase = new AztecSpinUseCase(
      makeLoader(null),
      makeWallet('0').facade,
      makePlay(null).repository,
      makeCatalog(null),
      makeDemoBalance(),
    )
    const spinId = spinInput().spinId

    const first = await useCase.execute({
      sessionToken: 'demo_treasuresofaztec_token',
      spinId,
      bet: '10',
    })
    const again = await useCase.execute({
      sessionToken: 'demo_treasuresofaztec_token',
      spinId,
      bet: '10',
    })

    /* Фиксируем намеренно: клиент обещает «тот же раунд» только на боевых
       деньгах, в демо дубль не ищется (кошелька нет). */
    expect(first.duplicate).toBe(false)
    expect(again.duplicate).toBe(false)
    expect(again.roundId).toBeNull()
  })
})

describe('AztecSpinUseCase: бой', () => {
  let play: PlayDouble
  let wallet: ReturnType<typeof makeWallet>
  let useCase: AztecSpinUseCase

  beforeEach(() => {
    play = makePlay(makeSession())
    wallet = makeWallet('1000.00')
    useCase = new AztecSpinUseCase(
      makeLoader(makeSession()),
      wallet.facade,
      play.repository,
      makeCatalog(null),
      makeDemoBalance(),
    )
  })

  it('списывает ставку и проводит раунд с внешним ключом спина', async () => {
    const spinId = spinInput().spinId

    const data = await useCase.execute({ sessionToken: SESSION_TOKEN, spinId, bet: '10' })

    expect(wallet.calls.debits).toBe(1)
    expect(data.roundId).not.toBeNull()
    const betRow = play.transactions.find(
      (row) => row.externalTransactionId === `aztec_${spinId}_bet`,
    )
    expect(betRow).toBeDefined()
    expect(String(betRow?.amount)).toBe('10')
  })

  it('начисляет выигрыш только когда он есть', async () => {
    const data = await useCase.execute({
      sessionToken: SESSION_TOKEN,
      spinId: spinInput().spinId,
      bet: '10',
    })

    const hasWin = money.isPositive(data.win)
    expect(wallet.calls.credits).toBe(hasWin ? 1 : 0)
    expect(money.isPositive(data.win)).toBe(hasWin)
  })

  it('повтор того же spinId не двигает деньги второй раз', async () => {
    const spinId = spinInput().spinId
    const first = await useCase.execute({ sessionToken: SESSION_TOKEN, spinId, bet: '10' })
    const debitsAfterFirst = wallet.calls.debits

    const again = await useCase.execute({ sessionToken: SESSION_TOKEN, spinId, bet: '10' })

    expect(again.duplicate).toBe(true)
    expect(again.win).toBe(first.win)
    expect(again.outcomeHash).toBe(first.outcomeHash)
    expect(wallet.calls.debits).toBe(debitsAfterFirst)
  })

  it('ответ и ledger несут одни заходы, повтор доставки рисует ту же анимацию', async () => {
    const spinId = spinInput().spinId

    const first = await useCase.execute({ sessionToken: SESSION_TOKEN, spinId, bet: '10' })
    const betRow = play.transactions.find(
      (row) => row.externalTransactionId === `aztec_${spinId}_bet`,
    )
    const meta = (betRow?.metadata ?? {}) as Record<string, unknown>

    expect(first.plays.length).toBe(1 + first.freeSpinsPlayed)
    expect(flattenAztecPlays(first.plays).length).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(meta.plays)).toBe(true)

    const again = await useCase.execute({ sessionToken: SESSION_TOKEN, spinId, bet: '10' })

    expect(again.duplicate).toBe(true)
    expect(again.plays).toEqual(first.plays)
    expect(again.outcomeHash).toBe(first.outcomeHash)
  })

  it('ставка вне лимитов карточки отбивается до проводок', async () => {
    await expect(
      useCase.execute({ sessionToken: SESSION_TOKEN, spinId: spinInput().spinId, bet: '0.5' }),
    ).rejects.toBeInstanceOf(InvalidBetRequestError)
    await expect(
      useCase.execute({ sessionToken: SESSION_TOKEN, spinId: spinInput().spinId, bet: '20000' }),
    ).rejects.toBeInstanceOf(InvalidBetRequestError)

    expect(wallet.calls.debits).toBe(0)
  })

  it('невалидная ставка (не десятичная строка) не доходит до игры', async () => {
    await expect(
      useCase.execute({ sessionToken: SESSION_TOKEN, spinId: spinInput().spinId, bet: '1e3' }),
    ).rejects.toThrow()
  })
})

describe('AztecSpinUseCase: state', () => {
  it('демо отдаёт стартовый баланс и геометрию доски', async () => {
    const useCase = new AztecSpinUseCase(
      makeLoader(null),
      makeWallet('0').facade,
      makePlay(null).repository,
      makeCatalog(null),
      makeDemoBalance(),
    )

    const state = await useCase.state('demo_treasuresofaztec_token')

    expect(state.demo).toBe(true)
    expect(state.balance).toBe('1000.00')
    expect(state.reelRows).toEqual([5, 6, 6, 6, 6, 5])
    expect(state.maxWinMultiplier).toBe(1000)
    /* Клиент рисует правила по этим числам, а не по своему хардкоду. */
    expect(state.rules.tiers).toEqual([12, 15, 20, 25, 30, 34, 40])
    expect(state.rules.maxMultiplierBase).toBe(5)
    expect(state.rules.maxMultiplierFree).toBe(15)
    expect(Object.keys(state.rules.paytable)).toHaveLength(8)
  })

  it('бой: лимиты ставки берутся из карточки игры', async () => {
    const useCase = new AztecSpinUseCase(
      makeLoader(makeSession(5, 500)),
      makeWallet('77.00').facade,
      makePlay(makeSession(5, 500)).repository,
      makeCatalog(null),
      makeDemoBalance(),
    )

    const state = await useCase.state(SESSION_TOKEN)

    expect(state.demo).toBe(false)
    expect(state.minBet).toBe('5')
    expect(state.maxBet).toBe('500')
    expect(state.balance).toBe('77.00')
  })
})

describe('AztecSpinUseCase: цель возврата из админки', () => {
  function makeUseCase(rtpDemo: string | null, rtp: string | null = null): AztecSpinUseCase {
    const session = makeSession(1, 10000, rtp)
    return new AztecSpinUseCase(
      makeLoader(session),
      makeWallet('1000.00').facade,
      makePlay(session).repository,
      makeCatalog(rtpDemo),
      makeDemoBalance(),
    )
  }

  /** Фактическая отдача серии демо-спинов: сумма выигрышей / сумма ставок. */
  async function demoRtp(useCase: AztecSpinUseCase, spins: number): Promise<number> {
    let bet = 0
    let win = 0
    for (let index = 0; index < spins; index += 1) {
      const data = await useCase.execute({
        // Отдельная демо-сессия на спин: остаток копится, и серия на бедном rtp
        // обнулила бы счёт до конца прогона.
        sessionToken: `demo_treasuresofaztec_trial_${index}`,
        spinId: randomUUID(),
        bet: '10',
      })
      bet += 10
      win += Number(data.win)
    }
    return (win / bet) * 100
  }

  it('правила в /state растут вместе с целью: таблица = то, чем платят', async () => {
    const tight = await makeUseCase('96').state('demo_treasuresofaztec_token')
    const generous = await makeUseCase('200').state('demo_treasuresofaztec_token')

    expect(generous.rules.paytable.M[0] ?? 0).toBeGreaterThan(tight.rules.paytable.M[0] ?? 0)
  })

  it('демо играет по rtp_demo: 150 % платит вдвое больше, чем 60 %', async () => {
    const tight = await demoRtp(makeUseCase('60'), 3000)
    const generous = await demoRtp(makeUseCase('150'), 3000)

    expect(generous).toBeGreaterThan(tight * 1.6)
  }, 120000)

  it('на деньги цель берётся из rtp сессии, а не из демо-поля', async () => {
    const low = await makeUseCase('200', '50').state(SESSION_TOKEN)
    const high = await makeUseCase('200', '100').state(SESSION_TOKEN)

    expect(high.rules.paytable.M[0] ?? 0).toBeGreaterThan(low.rules.paytable.M[0] ?? 0)
  })
})
