import { randomBytes } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'
import { z } from 'zod'

import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { DEMO_TOKEN_PREFIX, OriginalsSessionLoader } from './originals-session-loader'
import { TIGER_DEMO_START_CREDIT } from './originals-session.use-case'
import { InvalidBetRequestError } from '../../domain/errors'
import {
  HOUSE_SLOT_GAMES,
  type HouseSlotGameConfig,
  type IHouseSlotGames,
} from '../../domain/house-slot-game'
import {
  GAME_PLAY_REPOSITORY,
  type GameRow,
  type GameSessionWithGame,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'
import {
  TIGER_ROW_INDEX,
  TigerSpinRowSchema,
  type TigerSpinRow,
} from '../../infrastructure/providers/house/spin-data/tiger-spin-row'

/**
 * Вход спина от фронта Construct 3 (x-www-form-urlencoded):
 * betamount/numline/cpl. Деньги — строками, целые — строками целых.
 */
export const OriginalsSpinSchema = z.object({
  betamount: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, 'betamount must be a decimal string')
    .refine((value) => money.isGreaterThan(value, '0'), 'betamount must be positive')
    .refine((value) => !money.isGreaterThan(value, '1000'), 'betamount is too large'),
  numline: z.coerce.number().int().min(1).max(5).transform(String),
  cpl: z.coerce.number().int().min(1).max(10).transform(String),
})
export type OriginalsSpinInput = z.infer<typeof OriginalsSpinSchema>

export interface TigerSpinRequest {
  sessionToken: string
  betamount: string
  numline: string
  cpl: string
}

export interface TigerSpinPull {
  TotalWay: number
  FreeSpin: number
  LastMultiply: number
  WildFixedIcons: unknown[]
  HasJackpot: boolean
  HasScatter: boolean
  CountScatter: number
  WildColumIcon: string
  MultipyScatter: number
  MultiplyCount: number
  WinLogs: string[]
  DropLine: number
  MultipleList: unknown[]
  WinAmount: number
  WinOnDrop: number
  SlotIcons: string[]
  ActiveIcons: number[]
  ActiveLines: unknown[]
  DropLineData: unknown[]
}

export interface TigerSpinData {
  credit: number
  freemode: boolean
  jackpot: number
  free_spin: number
  free_num: number
  scaler: number
  num_line: number
  cpl: number
  betamount: number
  bet_amount: number
  pull: TigerSpinPull
}

/** Тип Prisma-транзакции из фасада кошелька (прямой импорт prisma в application запрещён). */
type WalletTransaction = Parameters<Parameters<WalletFacade['runInTransaction']>[1]>[0]

/**
 * Лотерея исхода: зеркало SpinStructure донора. Таблицы игры тасуются,
 * от win берут первые rtpPercent строк, от lose — первые (100 - rtpPercent),
 * общий пул тасуется и берётся первый элемент.
 * Чистая функция: randomSource инжектится для тестов.
 */
export function drawSlotOutcome(
  winRows: TigerSpinRow[],
  loseRows: TigerSpinRow[],
  rtpPercent: number,
  randomSource: () => number = Math.random,
): TigerSpinRow {
  const winQuota = Math.max(0, Math.min(100, Math.floor(rtpPercent)))
  const loseQuota = 100 - winQuota
  const winPool = shuffleCopy(winRows, randomSource).slice(0, winQuota)
  const losePool = shuffleCopy(loseRows, randomSource).slice(0, loseQuota)
  const pool = shuffleCopy([...winPool, ...losePool], randomSource)
  const outcome = pool[0]
  if (!outcome) {
    throw new InvalidBetRequestError()
  }
  return outcome
}

export function shuffleCopy<T>(rows: T[], randomSource: () => number): T[] {
  const copy = [...rows]
  for (let index = copy.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(randomSource() * (index + 1))
    const current = copy[index] as T
    copy[index] = copy[swapIndex] as T
    copy[swapIndex] = current
  }
  return copy
}

/** RTP записи игры (Decimal из БД) в целые проценты донора, 0..100. */
export function parseRtpPercent(rawRtp: unknown): number {
  const parsed = Number(String(rawRtp ?? 70))
  if (!Number.isFinite(parsed)) {
    return 70
  }
  return Math.max(0, Math.min(100, Math.floor(parsed)))
}

function toFrontMoney(amount: string): number {
  return new Decimal(amount).toDecimalPlaces(2).toNumber()
}

@Injectable()
export class OriginalsSpinUseCase {
  constructor(
    @Inject(OriginalsSessionLoader) private readonly sessionLoader: OriginalsSessionLoader,
    @Inject(WalletFacade) private readonly wallet: WalletFacade,
    @Inject(GAME_PLAY_REPOSITORY) private readonly play: IGamePlayRepository,
    @Inject(HOUSE_SLOT_GAMES) private readonly slotGames: IHouseSlotGames,
  ) {}

  async execute(request: TigerSpinRequest): Promise<TigerSpinData> {
    const parsed = OriginalsSpinSchema.parse({
      betamount: request.betamount,
      numline: request.numline,
      cpl: request.cpl,
    })
    const betTotal = money.multiply(money.multiply(parsed.betamount, parsed.cpl), parsed.numline)
    if (request.sessionToken.startsWith(DEMO_TOKEN_PREFIX)) {
      return this.executeDemoSpin(parsed, betTotal)
    }
    return this.executeRealSpin(request.sessionToken, parsed, betTotal)
  }

  private executeDemoSpin(parsed: OriginalsSpinInput, betTotal: string): TigerSpinData {
    const game = this.slotGames.getGameConfig('fortunetiger')
    if (!game) {
      throw new InvalidBetRequestError()
    }
    const outcome = drawSlotOutcome(game.winRows, game.loseRows, 90)
    const winTotal = money.multiply(
      money.multiply(parsed.betamount, parsed.cpl),
      String(outcome[TIGER_ROW_INDEX.payout]),
    )
    const displayCredit = money.add(money.subtract(TIGER_DEMO_START_CREDIT, betTotal), winTotal)
    return this.buildSpinData({
      credit: displayCredit,
      parsed,
      betTotal,
      winTotal,
      outcome,
    })
  }

  private async executeRealSpin(
    sessionToken: string,
    parsed: OriginalsSpinInput,
    betTotal: string,
  ): Promise<TigerSpinData> {
    const { session, game } = await this.sessionLoader.loadActiveSlotSession(sessionToken)
    const providerId = session.providerId
    const roundExternalId = `${game.externalGameId}_${randomBytes(8).toString('hex')}`
    const betExternalId = `${roundExternalId}_bet`
    const duplicate = await this.play.findTransactionByExternal(providerId, betExternalId)
    if (duplicate) {
      return this.buildDuplicateSpinData(session, game, parsed, betTotal)
    }
    return this.wallet.runInTransaction(
      { userId: session.userId, currency: session.currency as Currency },
      (transaction) =>
        this.applySpin({
          session,
          game,
          providerId,
          parsed,
          betTotal,
          roundExternalId,
          transaction,
        }),
    )
  }

  private async applySpin(args: {
    session: GameSessionWithGame
    game: HouseSlotGameConfig
    providerId: string
    parsed: OriginalsSpinInput
    betTotal: string
    roundExternalId: string
    transaction: WalletTransaction
  }): Promise<TigerSpinData> {
    const { session, game, providerId, parsed, betTotal, roundExternalId, transaction } = args
    const betExternalId = `${roundExternalId}_bet`
    const raceDuplicate = await this.play.findTransactionByExternal(
      providerId,
      betExternalId,
      transaction,
    )
    if (raceDuplicate) {
      return this.buildDuplicateSpinData(session, game, parsed, betTotal)
    }
    const outcome = drawSlotOutcome(game.winRows, game.loseRows, parseRtpPercent(session.game.rtp))
    const winTotal = money.multiply(
      money.multiply(parsed.betamount, parsed.cpl),
      String(outcome[TIGER_ROW_INDEX.payout]),
    )
    const round = await this.play.createRound(
      {
        sessionId: session.id,
        userId: session.userId,
        gameId: session.gameId,
        providerId,
        externalRoundId: roundExternalId,
        currency: session.currency,
        status: 'open',
      },
      transaction,
    )
    const settled = await this.settleBet({
      session,
      game,
      providerId,
      betTotal,
      betExternalId,
      round,
      transaction,
    })
    const balanceAfter = money.isPositive(winTotal)
      ? await this.settleWin({
          session,
          game,
          providerId,
          betTotal,
          winTotal,
          round,
          roundExternalId,
          transaction,
        })
      : await this.closeLosingRound({
          betTotal,
          round,
          transaction,
          settledBalance: settled.balanceAfter,
        })
    return this.buildSpinData({
      credit: balanceAfter,
      parsed,
      betTotal,
      winTotal,
      outcome,
    })
  }

  /** Списание ставки + bet-запись + счётчик сессии (вынос из applySpin, лимит 60 строк). */
  private async settleBet(args: {
    session: GameSessionWithGame
    game: HouseSlotGameConfig
    providerId: string
    betTotal: string
    betExternalId: string
    round: GameRow
    transaction: WalletTransaction
  }): Promise<{ balanceAfter: string }> {
    const { session, game, providerId, betTotal, betExternalId, round, transaction } = args
    const debitResult = await this.wallet.debit({
      userId: session.userId,
      currency: session.currency as Currency,
      amount: betTotal,
      type: 'BET',
      idempotencyKey: `${game.externalGameId}bet_${providerId}_${betExternalId}`,
      description: `Ставка ${game.displayName}`,
      metadata: { provider_id: providerId, game_id: session.gameId, round_id: round.id },
      tx: transaction,
    })
    await this.play.createTransaction(
      {
        roundId: round.id,
        sessionId: session.id,
        userId: session.userId,
        providerId,
        type: 'bet',
        externalTransactionId: betExternalId,
        amount: betTotal,
        currency: session.currency,
        balanceAfter: debitResult.balanceAfter,
        ledgerEntryId: debitResult.ledgerEntryId,
        metadata: { game: game.externalGameId },
      },
      transaction,
    )
    await this.play.addSessionBet(session.id, betTotal, transaction)
    return { balanceAfter: debitResult.balanceAfter }
  }

  /** Начисление выигрыша + win-запись + закрытие раунда (вынос из applySpin). */
  private async settleWin(args: {
    session: GameSessionWithGame
    game: HouseSlotGameConfig
    providerId: string
    betTotal: string
    winTotal: string
    round: GameRow
    roundExternalId: string
    transaction: WalletTransaction
  }): Promise<string> {
    const { session, game, providerId, betTotal, winTotal, round, roundExternalId, transaction } =
      args
    const winExternalId = `${roundExternalId}_win`
    const creditResult = await this.wallet.credit({
      userId: session.userId,
      currency: session.currency as Currency,
      amount: winTotal,
      type: 'WIN',
      idempotencyKey: `${game.externalGameId}win_${providerId}_${winExternalId}`,
      description: `Выигрыш ${game.displayName}`,
      metadata: { provider_id: providerId, game_id: session.gameId, round_id: round.id },
      tx: transaction,
    })
    await this.play.createTransaction(
      {
        roundId: round.id,
        sessionId: session.id,
        userId: session.userId,
        providerId,
        type: 'win',
        externalTransactionId: winExternalId,
        amount: winTotal,
        currency: session.currency,
        balanceAfter: creditResult.balanceAfter,
        ledgerEntryId: creditResult.ledgerEntryId,
        metadata: { game: game.externalGameId },
      },
      transaction,
    )
    await this.play.updateRound(
      round.id,
      { totalBet: betTotal, totalWin: winTotal, status: 'closed', closedAt: new Date() },
      transaction,
    )
    await this.play.addSessionWin(session.id, winTotal, transaction)
    return creditResult.balanceAfter
  }

  /** Закрытие проигрышного раунда без проводки выигрыша (вынос из applySpin). */
  private async closeLosingRound(args: {
    betTotal: string
    round: GameRow
    transaction: WalletTransaction
    settledBalance: string
  }): Promise<string> {
    const { betTotal, round, transaction, settledBalance } = args
    await this.play.updateRound(
      round.id,
      { totalBet: betTotal, totalWin: '0', status: 'closed', closedAt: new Date() },
      transaction,
    )
    return settledBalance
  }

  private async buildDuplicateSpinData(
    session: GameSessionWithGame,
    game: HouseSlotGameConfig,
    parsed: OriginalsSpinInput,
    betTotal: string,
  ): Promise<TigerSpinData> {
    const fallbackRow = game.loseRows[0]
    if (!fallbackRow) {
      throw new InvalidBetRequestError()
    }
    const balance = await this.wallet.getBalance(session.userId, session.currency as Currency)
    return this.buildSpinData({
      credit: balance.balance,
      parsed,
      betTotal,
      winTotal: '0',
      outcome: fallbackRow,
    })
  }

  private buildSpinData(args: {
    credit: string
    parsed: OriginalsSpinInput
    betTotal: string
    winTotal: string
    outcome: TigerSpinRow
  }): TigerSpinData {
    const { credit, parsed, betTotal, winTotal, outcome } = args
    const validated: TigerSpinRow = TigerSpinRowSchema.parse(outcome)
    const activeLines = validated[TIGER_ROW_INDEX.activeLines].map((line) => ({
      ...line,
      win_amount: toFrontMoney(winTotal),
    }))
    return {
      credit: toFrontMoney(credit),
      freemode: false,
      jackpot: 0,
      free_spin: 0,
      free_num: 0,
      scaler: 0,
      num_line: Number(parsed.numline),
      cpl: Number(parsed.cpl),
      betamount: Number(parsed.betamount),
      bet_amount: toFrontMoney(betTotal),
      pull: {
        TotalWay: 27,
        FreeSpin: 0,
        LastMultiply: 0,
        WildFixedIcons: [],
        HasJackpot: false,
        HasScatter: false,
        CountScatter: 0,
        WildColumIcon: '',
        MultipyScatter: 0,
        MultiplyCount: 2,
        WinLogs: this.buildWinLogs(parsed, betTotal, winTotal, validated),
        DropLine: 3,
        MultipleList: [],
        WinAmount: toFrontMoney(winTotal),
        WinOnDrop: toFrontMoney(winTotal),
        SlotIcons: validated[TIGER_ROW_INDEX.slotIcons],
        ActiveIcons: validated[TIGER_ROW_INDEX.activeIcons],
        ActiveLines: activeLines,
        DropLineData: validated[TIGER_ROW_INDEX.dropLineData],
      },
    }
  }

  private buildWinLogs(
    parsed: OriginalsSpinInput,
    betTotal: string,
    winTotal: string,
    outcome: TigerSpinRow,
  ): string[] {
    const betLog =
      `[BET] betLevel: ${parsed.cpl}, betSize:${parsed.betamount}, ` +
      `baseBet:${betTotal} => ${betTotal}`
    const firstLine = outcome[TIGER_ROW_INDEX.activeLines][0]
    if (!firstLine || !money.isPositive(winTotal)) {
      return [betLog]
    }
    const winLog =
      `[WIN] line 1: ${firstLine.combine}[${firstLine.name}] payout: ${firstLine.payout} ` +
      `(*multipy:1) x ${parsed.cpl} x ${parsed.betamount} => ${winTotal}`
    return [betLog, winLog]
  }
}
