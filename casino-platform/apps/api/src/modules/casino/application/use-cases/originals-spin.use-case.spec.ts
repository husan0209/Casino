import { type Prisma } from '@prisma/client'
import { Decimal } from 'decimal.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { money } from '@casino/shared-utils'

import { OriginalsSessionLoader } from './originals-session-loader'
import {
  OriginalsSpinSchema,
  OriginalsSpinUseCase,
  drawSlotOutcome,
  parseRtpPercent,
} from './originals-spin.use-case'
import {
  type GameSessionWithGame,
  type GameTransactionRow,
  type GameRow,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'
import {
  FORTUNE_TIGER_LOSE_ROWS,
  FORTUNE_TIGER_WIN_ROWS,
} from '../../infrastructure/providers/house/spin-data/fortune-tiger.tables'
import { type TigerSpinRow } from '../../infrastructure/providers/house/spin-data/tiger-spin-row'

import type { HouseSlotGameConfig, IHouseSlotGames } from '../../domain/house-slot-game'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const GAME_ID = '33333333-3333-4333-8333-333333333333'
const PROVIDER_ID = '44444444-4444-4444-8444-444444444444'
const SESSION_TOKEN = 'tiger_session_token_for_pilot_tests_only'

/**
 * Decimal-поля Prisma-строк в фейках: Prisma.Decimal расширяет decimal.js,
 * поэтому рантайм-конструктор decimal.js (объявленная зависимость) полностью
 * совместим; импорт Prisma — только типовый, без рантайм-зависимости.
 */
function decimalValue(raw: string | number | object): Prisma.Decimal {
  return new Decimal(String(raw)) as unknown as Prisma.Decimal
}

function makeSession(externalGameId = 'fortunetiger'): GameSessionWithGame {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    gameId: GAME_ID,
    providerId: PROVIDER_ID,
    sessionToken: SESSION_TOKEN,
    currency: 'RUB',
    isDemo: false,
    status: 'active',
    ipAddress: '127.0.0.1',
    userAgent: null,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    closedAt: null,
    totalBet: decimalValue('0'),
    totalWin: decimalValue('0'),
    roundsPlayed: 0,
    metadata: {},
    game: {
      id: GAME_ID,
      providerId: PROVIDER_ID,
      externalGameId,
      slug: 'fortune-tiger-pilot',
      name: 'Fortune Tiger',
      nameRu: 'Тигр',
      type: 'slot',
      category: 'slots',
      subcategory: null,
      thumbnailUrl: null,
      bannerUrl: null,
      isEnabled: true,
      isFeatured: false,
      isNew: false,
      isPopular: false,
      hasDemo: true,
      rtp: decimalValue('70'),
      volatility: null,
      maxWinMultiplier: null,
      minBet: null,
      maxBet: null,
      supportedCurrencies: ['RUB'],
      tags: [],
      sortOrder: 0,
      launchCount: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as GameSessionWithGame
}

/** Фейк реестра house-слотов: настоящий тигр из сгенерированных таблиц. */
function makeSlotGames(): IHouseSlotGames {
  const tigerConfig: HouseSlotGameConfig = {
    externalGameId: 'fortunetiger',
    displayName: 'Fortune Tiger',
    winRows: FORTUNE_TIGER_WIN_ROWS as HouseSlotGameConfig['winRows'],
    loseRows: FORTUNE_TIGER_LOSE_ROWS as HouseSlotGameConfig['loseRows'],
    icons: {
      success: true as const,
      data: [],
      message: 'List icons success',
    },
  }
  return {
    getGameConfig: (externalGameId: string) =>
      externalGameId === 'fortunetiger' ? tigerConfig : null,
  }
}

/** Фейк IGamePlayRepository: покрывает весь порт, неучаствующее кидает. */
function makePlayRepository(session: GameSessionWithGame): {
  repository: IGamePlayRepository
  transactions: GameTransactionRow[]
} {
  const transactions: GameTransactionRow[] = []
  const repository: IGamePlayRepository = {
    findSessionByTokenWithUser: () => {
      throw new Error('not used in pilot spec')
    },
    findSessionByTokenWithGame: (token: string) =>
      Promise.resolve(token === SESSION_TOKEN ? session : null),
    findSessionByToken: () => {
      throw new Error('not used in pilot spec')
    },
    closeActiveSessions: () => Promise.resolve(),
    createSession: () => {
      throw new Error('not used in pilot spec')
    },
    touchSession: () => Promise.resolve(),
    addSessionBet: () => Promise.resolve(),
    addSessionWin: () => Promise.resolve(),
    findRoundByExternal: () => Promise.resolve(null),
    createRound: (data) =>
      Promise.resolve({
        id: 'round-1',
        sessionId: data.sessionId,
        userId: data.userId,
        gameId: data.gameId,
        providerId: data.providerId,
        externalRoundId: data.externalRoundId,
        status: 'open',
        currency: data.currency,
        totalBet: decimalValue('0'),
        totalWin: decimalValue('0'),
        createdAt: new Date(),
        closedAt: null,
      } as GameRow),
    updateRound: () => Promise.resolve(),
    findTransactionByExternal: (_providerId: string, externalId: string) =>
      Promise.resolve(transactions.find((row) => row.externalTransactionId === externalId) ?? null),
    findRollbackOf: () => Promise.resolve(null),
    createTransaction: (data) => {
      const row = {
        id: `tx-${transactions.length + 1}`,
        roundId: data.roundId,
        sessionId: data.sessionId,
        userId: data.userId,
        providerId: data.providerId,
        type: data.type,
        externalTransactionId: data.externalTransactionId,
        amount: decimalValue(data.amount),
        currency: data.currency,
        balanceAfter: decimalValue(data.balanceAfter),
        ledgerEntryId: data.ledgerEntryId,
        metadata: {},
        createdAt: new Date(),
      } as GameTransactionRow
      transactions.push(row)
      return Promise.resolve(row)
    },
  }
  return { repository, transactions }
}

function makeWalletFacade(startBalance: string): {
  facade: WalletFacade
  calls: { debits: number; credits: number }
  currentBalance: () => string
} {
  let balance = startBalance
  const calls = { debits: 0, credits: 0 }
  const facade = {
    debit: (input: { amount: string; idempotencyKey: string }) => {
      calls.debits += 1
      balance = money.subtract(balance, input.amount)
      return Promise.resolve({
        balanceBefore: startBalance,
        balanceAfter: balance,
        ledgerEntryId: `ledger-debit-${calls.debits}`,
        duplicate: false,
      })
    },
    credit: (input: { amount: string; idempotencyKey: string }) => {
      calls.credits += 1
      balance = money.add(balance, input.amount)
      return Promise.resolve({
        balanceBefore: startBalance,
        balanceAfter: balance,
        ledgerEntryId: `ledger-credit-${calls.credits}`,
        duplicate: false,
      })
    },
    getBalance: () =>
      Promise.resolve({ currency: 'RUB', balance, locked: '0', available: balance }),
    runInTransaction: <T>(
      _target: unknown,
      handler: (transaction: unknown) => Promise<T>,
    ): Promise<T> => handler({}),
  } as unknown as WalletFacade
  return { facade, calls, currentBalance: () => balance }
}

describe('parseRtpPercent', () => {
  it('clamps to 0..100 and defaults to 70', () => {
    expect(parseRtpPercent('70')).toBe(70)
    expect(parseRtpPercent(null)).toBe(70)
    expect(parseRtpPercent('garbage')).toBe(70)
    expect(parseRtpPercent('140')).toBe(100)
    expect(parseRtpPercent('-5')).toBe(0)
    expect(parseRtpPercent('96.9')).toBe(96)
  })
})

describe('drawSlotOutcome', () => {
  it('returns only win rows at rtp 100', () => {
    for (let spin = 0; spin < 20; spin++) {
      const outcome = drawSlotOutcome(FORTUNE_TIGER_WIN_ROWS, FORTUNE_TIGER_LOSE_ROWS, 100)
      expect(outcome[5]).toBeGreaterThan(0)
    }
  })

  it('returns only lose rows at rtp 0', () => {
    for (let spin = 0; spin < 20; spin++) {
      const outcome = drawSlotOutcome(FORTUNE_TIGER_WIN_ROWS, FORTUNE_TIGER_LOSE_ROWS, 0)
      expect(outcome[5]).toBe(0)
    }
  })

  it('every table row keeps the 6-column donor shape', () => {
    const allRows: TigerSpinRow[] = [...FORTUNE_TIGER_WIN_ROWS, ...FORTUNE_TIGER_LOSE_ROWS]
    expect(allRows.length).toBe(32)
    for (const row of allRows) {
      expect(row[0].length).toBe(9)
      expect(Array.isArray(row[1])).toBe(true)
      expect(Array.isArray(row[2])).toBe(true)
    }
  })
})

describe('OriginalsSpinSchema', () => {
  it('accepts form-urlencoded strings', () => {
    expect(OriginalsSpinSchema.parse({ betamount: '0.2', numline: '5', cpl: '1' })).toEqual({
      betamount: '0.2',
      numline: '5',
      cpl: '1',
    })
  })

  it('rejects non-positive and oversized bets', () => {
    expect(() => OriginalsSpinSchema.parse({ betamount: '0', numline: '5', cpl: '1' })).toThrow()
    expect(() => OriginalsSpinSchema.parse({ betamount: '-2', numline: '5', cpl: '1' })).toThrow()
    expect(() => OriginalsSpinSchema.parse({ betamount: '5000', numline: '5', cpl: '1' })).toThrow()
    expect(() => OriginalsSpinSchema.parse({ betamount: '0.2', numline: '9', cpl: '1' })).toThrow()
    expect(() => OriginalsSpinSchema.parse({ betamount: '0.2', numline: '5', cpl: '0' })).toThrow()
  })
})

describe('OriginalsSpinUseCase demo', () => {
  it('spins without touching the wallet', async () => {
    const session = makeSession()
    const play = makePlayRepository(session)
    const wallet = makeWalletFacade('1000.00')
    const slotGames = makeSlotGames()
    const loader = new OriginalsSessionLoader(play.repository, slotGames)
    const useCase = new OriginalsSpinUseCase(loader, wallet.facade, play.repository, slotGames)
    const debitSpy = vi.spyOn(wallet.facade, 'debit')
    const creditSpy = vi.spyOn(wallet.facade, 'credit')

    const result = await useCase.execute({
      sessionToken: 'demo_pilot_token',
      betamount: '2',
      numline: '5',
      cpl: '1',
    })

    expect(debitSpy).not.toHaveBeenCalled()
    expect(creditSpy).not.toHaveBeenCalled()
    expect(result.bet_amount).toBe(10)
    expect(result.pull.SlotIcons.length).toBe(9)
    const expectedCredit = 1000 - result.bet_amount + result.pull.WinAmount
    expect(result.credit).toBeCloseTo(expectedCredit, 8)
  })
})

describe('OriginalsSpinUseCase real', () => {
  let play: { repository: IGamePlayRepository; transactions: GameTransactionRow[] }
  let wallet: ReturnType<typeof makeWalletFacade>
  let slotGames: IHouseSlotGames
  let useCase: OriginalsSpinUseCase

  beforeEach(() => {
    play = makePlayRepository(makeSession())
    wallet = makeWalletFacade('500.00')
    slotGames = makeSlotGames()
    const loader = new OriginalsSessionLoader(play.repository, slotGames)
    useCase = new OriginalsSpinUseCase(loader, wallet.facade, play.repository, slotGames)
  })

  it('debits the bet once and keeps money consistent', async () => {
    const result = await useCase.execute({
      sessionToken: SESSION_TOKEN,
      betamount: '2',
      numline: '5',
      cpl: '1',
    })

    expect(result.bet_amount).toBe(10)
    expect(wallet.calls.debits).toBe(1)
    const expectedBalance = money.add('490', String(result.pull.WinAmount))
    expect(money.equals(wallet.currentBalance(), expectedBalance)).toBe(true)
    expect(result.credit).toBeCloseTo(Number(expectedBalance), 8)
  })

  it('writes bet and win game transactions with unique external ids', async () => {
    await useCase.execute({ sessionToken: SESSION_TOKEN, betamount: '0.2', numline: '5', cpl: '1' })
    await useCase.execute({ sessionToken: SESSION_TOKEN, betamount: '0.2', numline: '5', cpl: '1' })

    const betRows = play.transactions.filter((row) => row.type === 'bet')
    expect(betRows.length).toBe(2)
    const externalIds = play.transactions.map((row) => row.externalTransactionId)
    expect(new Set(externalIds).size).toBe(externalIds.length)
    const winRows = play.transactions.filter((row) => row.type === 'win')
    for (const winRow of winRows) {
      expect(money.isGreaterThan(String(winRow.amount), '0')).toBe(true)
    }
  })

  it('rejects spins on a closed session', async () => {
    const closedSession = makeSession()
    closedSession.status = 'closed'
    const closedPlay = makePlayRepository(closedSession)
    const closedLoader = new OriginalsSessionLoader(closedPlay.repository, slotGames)
    const closedUseCase = new OriginalsSpinUseCase(
      closedLoader,
      wallet.facade,
      closedPlay.repository,
      slotGames,
    )

    await expect(
      closedUseCase.execute({
        sessionToken: SESSION_TOKEN,
        betamount: '2',
        numline: '5',
        cpl: '1',
      }),
    ).rejects.toThrow()
  })

  it('rejects games missing from the slot registry', async () => {
    const foreignPlay = makePlayRepository(makeSession('unknown-game'))
    const foreignLoader = new OriginalsSessionLoader(foreignPlay.repository, slotGames)
    const foreignUseCase = new OriginalsSpinUseCase(
      foreignLoader,
      wallet.facade,
      foreignPlay.repository,
      slotGames,
    )

    await expect(
      foreignUseCase.execute({
        sessionToken: SESSION_TOKEN,
        betamount: '2',
        numline: '5',
        cpl: '1',
      }),
    ).rejects.toThrow('ORIGINALS_GAME_NOT_SUPPORTED')
  })
})
