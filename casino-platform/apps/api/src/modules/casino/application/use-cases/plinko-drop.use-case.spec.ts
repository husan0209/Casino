import { type Game, type Prisma } from '@prisma/client'
import { Decimal } from 'decimal.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { money } from '@casino/shared-utils'

import { OriginalsSessionLoader } from './originals-session-loader'
import { TIGER_DEMO_START_CREDIT } from './originals-session.use-case'
import {
  PlinkoDropSchema,
  PlinkoDropUseCase,
  drawPlinkoPath,
  hashPlinkoOutcome,
  plinkoExpectedRtp,
  plinkoMultiplier,
} from './plinko-drop.use-case'
import { type IDemoBalanceStore } from '../../domain/demo-balance'
import {
  type GameSessionWithGame,
  type GameTransactionRow,
  type GameRow,
  type IGameCatalogRepository,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'
import { DEMO_RTP_DEFAULT_PERCENT } from '../../domain/rtp-policy'
import { plinkoPackFor } from '../../infrastructure/providers/house/spin-data/plinko.rtp-pack'
import {
  PLINKO_MULTIPLIERS,
  PLINKO_RISK_VALUES,
  PLINKO_ROWS_VALUES,
} from '../../infrastructure/providers/house/spin-data/plinko.tables'

import type { HouseSlotGameConfig, IHouseSlotGames } from '../../domain/house-slot-game'

const USER_ID = '55555555-5555-4555-8555-555555555555'
const SESSION_ID = '66666666-6666-4666-8666-666666666666'
const GAME_ID = '77777777-7777-4777-8777-777777777777'
const PROVIDER_ID = '88888888-8888-4888-8888-888888888888'
const SESSION_TOKEN = 'plinko_session_token_for_pilot_tests_only'
const DROP_ID = '99999999-9999-4999-8999-999999999999'

/**
 * Decimal-поля Prisma-строк в фейках (тот же приём, что в tiger-спеке):
 * Prisma.Decimal расширяет decimal.js, импорт Prisma — только типовый.
 */
function decimalValue(raw: string | number | object): Prisma.Decimal {
  return new Decimal(String(raw)) as unknown as Prisma.Decimal
}

function makeSession(rtpOverride?: string | null): GameSessionWithGame {
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
      externalGameId: 'plinko',
      slug: 'plinko',
      name: 'Plinko',
      nameRu: 'Плинко',
      type: 'other',
      category: 'instant_games',
      subcategory: null,
      thumbnailUrl: null,
      bannerUrl: null,
      isEnabled: true,
      isFeatured: false,
      isNew: false,
      isPopular: false,
      hasDemo: true,
      rtp: rtpOverride === null ? null : decimalValue(rtpOverride ?? '99'),
      rtpDemo: decimalValue('99'),
      volatility: null,
      maxWinMultiplier: null,
      minBet: decimalValue('1'),
      maxBet: decimalValue('10000'),
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
        metadata: data.metadata ?? {},
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
    debit: (input: { amount: string }) => {
      calls.debits += 1
      balance = money.subtract(balance, input.amount)
      return Promise.resolve({
        balanceBefore: startBalance,
        balanceAfter: balance,
        ledgerEntryId: `ledger-debit-${calls.debits}`,
        duplicate: false,
      })
    },
    credit: (input: { amount: string }) => {
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

/** Фейк реестра слотов: plinko идёт своим путём, слоты не нужны. */
function makeSlotGames(): IHouseSlotGames {
  return {
    getGameConfig: (_externalGameId: string): HouseSlotGameConfig | null => null,
  }
}

/** Карточка plinko из каталога — нужна только для rtp_demo в демо-пути. */
function makeCatalog(rtpDemo: string | null): IGameCatalogRepository {
  const findByExternalGameId = async (): Promise<Game | null> =>
    rtpDemo === null ? null : ({ rtpDemo: decimalValue(rtpDemo) } as unknown as Game)
  return { findByExternalGameId } as unknown as IGameCatalogRepository
}

/** Карточка с лимитами ставки — проверка, что демо их тоже исполняет. */
function makeLimitedCatalog(minBet: string, maxBet: string): IGameCatalogRepository {
  const findByExternalGameId = async (): Promise<Game | null> =>
    ({
      rtpDemo: null,
      minBet: decimalValue(minBet),
      maxBet: decimalValue(maxBet),
    }) as unknown as Game
  return { findByExternalGameId } as unknown as IGameCatalogRepository
}

/**
 * Фейк демо-счёта: те же правила, что у Redis-скрипта, — списать можно только
 * если ставки хватает, и остаток хранится между бросками одной сессии.
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

function makeUseCase(args: {
  rtpDemo?: string | null
  sessionRtp?: string | null
  catalog?: IGameCatalogRepository
  demoBalance?: IDemoBalanceStore
}): PlinkoDropUseCase {
  const play = makePlayRepository(makeSession(args.sessionRtp))
  const wallet = makeWalletFacade('500.00')
  const loader = new OriginalsSessionLoader(play.repository, makeSlotGames())
  return new PlinkoDropUseCase(
    loader,
    wallet.facade,
    play.repository,
    args.catalog ?? makeCatalog(args.rtpDemo ?? null),
    args.demoBalance ?? makeDemoBalance(),
  )
}

describe('plinko payout tables calibration', () => {
  it('every table has rows+1 bins', () => {
    for (const rows of PLINKO_ROWS_VALUES) {
      for (const risk of PLINKO_RISK_VALUES) {
        const table = PLINKO_MULTIPLIERS[rows]?.[risk]
        expect(table, `missing table rows=${rows} risk=${risk}`).toBeDefined()
        expect(table?.length ?? 0).toBe(rows + 1)
      }
    }
  })

  it('expected RTP is within 97%..100% for all 27 configs', () => {
    for (const rows of PLINKO_ROWS_VALUES) {
      for (const risk of PLINKO_RISK_VALUES) {
        const expected = plinkoExpectedRtp(rows, risk)
        expect(expected).toBeGreaterThanOrEqual(0.97)
        expect(expected).toBeLessThanOrEqual(1.0)
      }
    }
  })
})

describe('drawPlinkoPath', () => {
  it('returns one fair bit per row and matching slot math', () => {
    const path = drawPlinkoPath(16, Buffer.alloc(32, 1))
    expect(path.length).toBe(16)
    expect(path.every((step) => step === 1)).toBe(true)
    const slotIndex = path.reduce<number>((sum, step) => sum + step, 0)
    expect(slotIndex).toBe(16)
    expect(plinkoMultiplier(16, 'medium', slotIndex, PLINKO_MULTIPLIERS)).toBe('110')
  })

  it('outcome hash is stable for the same drop', () => {
    const path = drawPlinkoPath(12, Buffer.alloc(32, 7))
    expect(hashPlinkoOutcome(path, DROP_ID)).toBe(hashPlinkoOutcome(path, DROP_ID))
    expect(hashPlinkoOutcome(path, DROP_ID).length).toBe(64)
  })
})

describe('PlinkoDropSchema', () => {
  const validDrop = { dropId: DROP_ID, bet: '10.00', risk: 'medium', rows: 16 }

  it('accepts a valid drop', () => {
    expect(PlinkoDropSchema.parse(validDrop)).toEqual(validDrop)
  })

  it('rejects bad money, risk, rows and drop id', () => {
    expect(() => PlinkoDropSchema.parse({ ...validDrop, bet: '0' })).toThrow()
    expect(() => PlinkoDropSchema.parse({ ...validDrop, bet: '-5' })).toThrow()
    expect(() => PlinkoDropSchema.parse({ ...validDrop, bet: 'abc' })).toThrow()
    expect(() => PlinkoDropSchema.parse({ ...validDrop, risk: 'extreme' })).toThrow()
    expect(() => PlinkoDropSchema.parse({ ...validDrop, rows: 7 })).toThrow()
    expect(() => PlinkoDropSchema.parse({ ...validDrop, rows: 17 })).toThrow()
    expect(() => PlinkoDropSchema.parse({ ...validDrop, dropId: 'not-a-uuid' })).toThrow()
  })
})

describe('PlinkoDropUseCase demo', () => {
  it('drops without touching the wallet', async () => {
    const play = makePlayRepository(makeSession())
    const wallet = makeWalletFacade('1000.00')
    const loader = new OriginalsSessionLoader(play.repository, makeSlotGames())
    const useCase = new PlinkoDropUseCase(
      loader,
      wallet.facade,
      play.repository,
      makeCatalog(null),
      makeDemoBalance(),
    )
    const debitSpy = vi.spyOn(wallet.facade, 'debit')
    const creditSpy = vi.spyOn(wallet.facade, 'credit')

    const result = await useCase.execute({
      sessionToken: 'demo_plinko_token',
      dropId: DROP_ID,
      bet: '10.00',
      risk: 'medium',
      rows: 16,
    })

    expect(debitSpy).not.toHaveBeenCalled()
    expect(creditSpy).not.toHaveBeenCalled()
    expect(result.path.length).toBe(16)
    expect(result.slotIndex).toBe(result.path.reduce((sum, step) => sum + step, 0))
    expect(result.outcomeHash.length).toBe(64)
  })

  it('копит остаток между бросками, а не пересчитывает его от старта', async () => {
    const demoBalance = makeDemoBalance()
    const useCase = makeUseCase({ demoBalance })
    const first = await useCase.execute({
      sessionToken: 'demo_plinko_token',
      dropId: DROP_ID,
      bet: '10.00',
      risk: 'medium',
      rows: 16,
    })
    const second = await useCase.execute({
      sessionToken: 'demo_plinko_token',
      dropId: '11111111-1111-4111-8111-111111111111',
      bet: '10.00',
      risk: 'medium',
      rows: 16,
    })

    const expectedAfterFirst = new Decimal(TIGER_DEMO_START_CREDIT)
      .minus(first.bet)
      .plus(first.win)
      .toString()
    expect(first.balance).toBe(expectedAfterFirst)
    // Второй бросок обязан считаться от остатка первого, а не от старта:
    // ровно на этом стоял баг «баланс не поднимается».
    const expectedAfterSecond = new Decimal(first.balance).minus(second.bet).plus(second.win)
    expect(new Decimal(second.balance).equals(expectedAfterSecond)).toBe(true)
    expect(demoBalance.balances.get('demo_plinko_token')).toBe(second.balance)
  })

  it('отказывает, когда демо-остатка не хватает, и не меняет счёт', async () => {
    const demoBalance = makeDemoBalance()
    demoBalance.balances.set('demo_plinko_token', '5.00')
    const useCase = makeUseCase({ demoBalance })

    await expect(
      useCase.execute({
        sessionToken: 'demo_plinko_token',
        dropId: DROP_ID,
        bet: '10.00',
        risk: 'medium',
        rows: 16,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })
    expect(demoBalance.balances.get('demo_plinko_token')).toBe('5.00')
  })

  it('исполняет лимиты ставки карточки и в демо', async () => {
    const useCase = makeUseCase({ catalog: makeLimitedCatalog('1', '1000') })

    await expect(
      useCase.execute({
        sessionToken: 'demo_plinko_token',
        dropId: DROP_ID,
        bet: '0.50',
        risk: 'medium',
        rows: 16,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BET_REQUEST' })
    await expect(
      useCase.execute({
        sessionToken: 'demo_plinko_token',
        dropId: '22222222-2222-4222-8222-222222222222',
        bet: '5000.00',
        risk: 'medium',
        rows: 16,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BET_REQUEST' })
  })
})

describe('PlinkoDropUseCase real', () => {
  let play: { repository: IGamePlayRepository; transactions: GameTransactionRow[] }
  let wallet: ReturnType<typeof makeWalletFacade>
  let useCase: PlinkoDropUseCase

  beforeEach(() => {
    play = makePlayRepository(makeSession())
    wallet = makeWalletFacade('500.00')
    const loader = new OriginalsSessionLoader(play.repository, makeSlotGames())
    useCase = new PlinkoDropUseCase(
      loader,
      wallet.facade,
      play.repository,
      makeCatalog(null),
      makeDemoBalance(),
    )
  })

  it('debits once, credits on win, keeps money consistent', async () => {
    const result = await useCase.execute({
      sessionToken: SESSION_TOKEN,
      dropId: DROP_ID,
      bet: '10.00',
      risk: 'low',
      rows: 8,
    })

    expect(wallet.calls.debits).toBe(1)
    const expectedWin = money.multiply('10.00', result.multiplier)
    expect(money.equals(result.win, expectedWin)).toBe(true)
    const expectedBalance = money.add(money.subtract('500.00', '10.00'), expectedWin)
    expect(money.equals(wallet.currentBalance(), expectedBalance)).toBe(true)
    expect(money.equals(result.balance, expectedBalance)).toBe(true)
  })

  it('rebuilds the identical drop on retry with the same dropId', async () => {
    const first = await useCase.execute({
      sessionToken: SESSION_TOKEN,
      dropId: DROP_ID,
      bet: '10.00',
      risk: 'medium',
      rows: 16,
    })
    const retry = await useCase.execute({
      sessionToken: SESSION_TOKEN,
      dropId: DROP_ID,
      bet: '10.00',
      risk: 'medium',
      rows: 16,
    })

    expect(retry.duplicate).toBe(true)
    expect(wallet.calls.debits).toBe(1)
    expect(retry.path).toEqual(first.path)
    expect(retry.multiplier).toBe(first.multiplier)
    expect(money.equals(retry.win, first.win)).toBe(true)
    expect(money.equals(retry.balance, first.balance)).toBe(true)
  })

  it('rejects bets outside the game card limits', async () => {
    await expect(
      useCase.execute({
        sessionToken: SESSION_TOKEN,
        dropId: DROP_ID,
        bet: '0.5',
        risk: 'low',
        rows: 8,
      }),
    ).rejects.toThrow()
    await expect(
      useCase.execute({
        sessionToken: SESSION_TOKEN,
        dropId: DROP_ID,
        bet: '50000',
        risk: 'low',
        rows: 8,
      }),
    ).rejects.toThrow()
  })
})

describe('PlinkoDropUseCase resolvePack — RTP из карточки игры', () => {
  it('демо играет по rtp_demo', async () => {
    const useCase = makeUseCase({ rtpDemo: '120' })
    const pack = await useCase.resolvePack('demo_plinko_token')
    expect(plinkoExpectedRtp(16, 'medium', pack)).toBeCloseTo(1.2, 2)
  })

  it('игра на деньги — по rtp сессии', async () => {
    const useCase = makeUseCase({ sessionRtp: '90' })
    const pack = await useCase.resolvePack(SESSION_TOKEN)
    expect(plinkoExpectedRtp(16, 'medium', pack)).toBeCloseTo(0.9, 2)
  })

  it('игра на деньги без значения поля — цель политики, а не донорский комплект', async () => {
    const pack = await makeUseCase({ sessionRtp: null }).resolvePack(SESSION_TOKEN)

    /* Раньше пустое поле отдавало донорский профиль (~99 %); теперь дефолт
       один на все движки — 96 из rtp-policy. Разница в 3 п.п. заметна игроку,
       поэтому она зафиксирована тестом, а не молча сменена. */
    expect(plinkoExpectedRtp(16, 'medium', pack)).toBeCloseTo(0.96, 2)
    expect(pack).not.toBe(PLINKO_MULTIPLIERS)
  })

  it('без значения в карточке демо играет по щедрой цели политики, а не по донорской', async () => {
    const useCase = makeUseCase({ rtpDemo: null })

    const pack = await useCase.resolvePack('demo_plinko_token')

    expect(pack).toEqual(plinkoPackFor(DEMO_RTP_DEFAULT_PERCENT))
    expect(pack).not.toBe(PLINKO_MULTIPLIERS)
  })

  it('демо и деньги на одной цели дают один и тот же комплект', async () => {
    const demo = await makeUseCase({ rtpDemo: '95' }).resolvePack('demo_plinko_token')
    const real = await makeUseCase({ rtpDemo: '95', sessionRtp: '95' }).resolvePack(SESSION_TOKEN)
    expect(demo).toBe(real)
  })
})
