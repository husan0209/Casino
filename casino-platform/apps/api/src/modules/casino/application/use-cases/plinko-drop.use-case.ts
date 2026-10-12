import { createHash, randomBytes } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'
import { z } from 'zod'

import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import {
  DEMO_TOKEN_PREFIX,
  OriginalsSessionLoader,
  PLINKO_EXTERNAL_GAME_ID,
} from './originals-session-loader'
import { TIGER_DEMO_START_CREDIT } from './originals-session.use-case'
import { InvalidBetRequestError } from '../../domain/errors'
import {
  GAME_PLAY_REPOSITORY,
  type GameRow,
  type GameSessionWithGame,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'
import {
  PlinkoRiskSchema,
  PlinkoRowsSchema,
  type PlinkoPath,
  type PlinkoRisk,
  type PlinkoRows,
} from '../../infrastructure/providers/house/spin-data/plinko-row'
import { PLINKO_MULTIPLIERS } from '../../infrastructure/providers/house/spin-data/plinko.tables'

/**
 * Вход дропа Plinko от фронта (JSON):
 * dropId — uuid шарика от клиента (идемпотентность повторных отправок),
 * bet — строка денег, risk/rows — конфиг доски.
 */
export const PlinkoDropSchema = z.object({
  dropId: z.string().uuid(),
  bet: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, 'bet must be a decimal string')
    .refine((value) => money.isGreaterThan(value, '0'), 'bet must be positive'),
  risk: PlinkoRiskSchema,
  rows: PlinkoRowsSchema,
})
export type PlinkoDropInput = z.infer<typeof PlinkoDropSchema>

export interface PlinkoDropRequest {
  sessionToken: string
  dropId: string
  bet: string
  risk: string
  rows: number
}

export interface PlinkoDropData {
  dropId: string
  roundId: string | null
  bet: string
  risk: PlinkoRisk
  rows: PlinkoRows
  path: number[]
  slotIndex: number
  multiplier: string
  win: string
  balance: string
  currency: string
  outcomeHash: string
  duplicate: boolean
}

/** Тип Prisma-транзакции из фасада кошелька (прямой импорт prisma в application запрещён). */
type WalletTransaction = Parameters<Parameters<WalletFacade['runInTransaction']>[1]>[0]

const DEFAULT_MIN_BET = '1'
const DEFAULT_MAX_BET = '10000'

/**
 * Путь шарика серверным CSPRNG: по одному биту на ряд.
 * Честный 50/50 без сидов пилота (схема коммитмента с сидами/нонсом —
 * follow-up, требует хранения сидов — см. REPORT пилота).
 */
export function drawPlinkoPath(
  rowCount: number,
  randomSource: Buffer = randomBytes(32),
): PlinkoPath {
  const path: PlinkoPath = []
  for (let row = 0; row < rowCount; row++) {
    path.push((randomSource[row % randomSource.length] as number) % 2 === 0 ? 0 : 1)
  }
  return path
}

/** Хэш исхода для後の проверки (фиксируем до анимации, отдаём клиенту). */
export function hashPlinkoOutcome(path: PlinkoPath, dropId: string): string {
  return createHash('sha256')
    .update(`${dropId}:${path.join('')}`)
    .digest('hex')
}

/** Множитель лунки по конфигу доски. */
export function plinkoMultiplier(rows: PlinkoRows, risk: PlinkoRisk, slotIndex: number): string {
  const table = PLINKO_MULTIPLIERS[rows]?.[risk]
  const multiplier = table?.[slotIndex]
  if (multiplier === undefined) {
    throw new InvalidBetRequestError()
  }
  return String(multiplier)
}

/**
 * Матожидание отдачи конфига при честной монете: сумма C(n,k)/2^n * mult[k].
 * Чистая функция для тестов калибровки таблиц.
 */
export function plinkoExpectedRtp(rows: PlinkoRows, risk: PlinkoRisk): number {
  const table = PLINKO_MULTIPLIERS[rows]?.[risk]
  if (!table) {
    throw new InvalidBetRequestError()
  }
  let expected = 0
  for (let slot = 0; slot <= rows; slot++) {
    expected += (binomialCoefficient(rows, slot) / 2 ** rows) * (table[slot] as number)
  }
  return expected
}

function binomialCoefficient(rowCount: number, slot: number): number {
  let result = 1
  const take = Math.min(slot, rowCount - slot)
  for (let step = 0; step < take; step++) {
    result = (result * (rowCount - step)) / (step + 1)
  }
  return Math.round(result)
}

function toMoneyString(raw: string): string {
  return new Decimal(raw).toString()
}

@Injectable()
export class PlinkoDropUseCase {
  constructor(
    @Inject(OriginalsSessionLoader) private readonly sessionLoader: OriginalsSessionLoader,
    @Inject(WalletFacade) private readonly wallet: WalletFacade,
    @Inject(GAME_PLAY_REPOSITORY) private readonly play: IGamePlayRepository,
  ) {}

  async execute(request: PlinkoDropRequest): Promise<PlinkoDropData> {
    const parsed = PlinkoDropSchema.parse({
      dropId: request.dropId,
      bet: request.bet,
      risk: request.risk,
      rows: request.rows,
    })
    if (request.sessionToken.startsWith(DEMO_TOKEN_PREFIX)) {
      return this.executeDemoDrop(parsed)
    }
    return this.executeRealDrop(request.sessionToken, parsed)
  }

  private executeDemoDrop(parsed: PlinkoDropInput): PlinkoDropData {
    const path = drawPlinkoPath(parsed.rows)
    const slotIndex = path.reduce<number>((sum, step) => sum + step, 0)
    const multiplier = plinkoMultiplier(parsed.rows, parsed.risk, slotIndex)
    const win = money.multiply(parsed.bet, multiplier)
    const balance = money.add(money.subtract(TIGER_DEMO_START_CREDIT, parsed.bet), win)
    return {
      dropId: parsed.dropId,
      roundId: null,
      bet: toMoneyString(parsed.bet),
      risk: parsed.risk,
      rows: parsed.rows,
      path,
      slotIndex,
      multiplier,
      win: toMoneyString(win),
      balance: toMoneyString(balance),
      currency: 'RUB',
      outcomeHash: hashPlinkoOutcome(path, parsed.dropId),
      duplicate: false,
    }
  }

  private async executeRealDrop(
    sessionToken: string,
    parsed: PlinkoDropInput,
  ): Promise<PlinkoDropData> {
    const session = await this.sessionLoader.loadActiveHouseSession(
      sessionToken,
      PLINKO_EXTERNAL_GAME_ID,
    )
    this.assertBetLimits(session, parsed.bet)
    const providerId = session.providerId
    const betExternalId = `plinko_${parsed.dropId}_bet`
    const stored = await this.play.findTransactionByExternal(providerId, betExternalId)
    if (stored) {
      return this.rebuildDuplicateDrop(session, providerId, parsed.dropId)
    }
    return this.wallet.runInTransaction(
      { userId: session.userId, currency: session.currency as Currency },
      (transaction) => this.applyDrop({ session, providerId, parsed, betExternalId, transaction }),
    )
  }

  /** Лимиты ставки из карточки игры (minBet/maxBet), по умолчанию 1..10000. */
  private assertBetLimits(session: GameSessionWithGame, bet: string): void {
    const minBet = session.game.minBet === null ? DEFAULT_MIN_BET : String(session.game.minBet)
    const maxBet = session.game.maxBet === null ? DEFAULT_MAX_BET : String(session.game.maxBet)
    if (money.isGreaterThan(minBet, bet) || money.isGreaterThan(bet, maxBet)) {
      throw new InvalidBetRequestError()
    }
  }

  private async applyDrop(args: {
    session: GameSessionWithGame
    providerId: string
    parsed: PlinkoDropInput
    betExternalId: string
    transaction: WalletTransaction
  }): Promise<PlinkoDropData> {
    const { session, providerId, parsed, betExternalId, transaction } = args
    const raceDuplicate = await this.play.findTransactionByExternal(
      providerId,
      betExternalId,
      transaction,
    )
    if (raceDuplicate) {
      return this.rebuildDuplicateDrop(session, providerId, parsed.dropId)
    }
    const path = drawPlinkoPath(parsed.rows)
    const slotIndex = path.reduce<number>((sum, step) => sum + step, 0)
    const multiplier = plinkoMultiplier(parsed.rows, parsed.risk, slotIndex)
    const win = money.multiply(parsed.bet, multiplier)
    const outcomeHash = hashPlinkoOutcome(path, parsed.dropId)
    const round = await this.play.createRound(
      {
        sessionId: session.id,
        userId: session.userId,
        gameId: session.gameId,
        providerId,
        externalRoundId: `plinko_${parsed.dropId}`,
        currency: session.currency,
        status: 'open',
      },
      transaction,
    )
    const settled = await this.settleBet({
      session,
      providerId,
      parsed,
      betExternalId,
      round,
      transaction,
      outcome: { path, slotIndex, multiplier, outcomeHash },
    })
    const balanceAfter = money.isPositive(win)
      ? await this.settleWin({
          session,
          providerId,
          parsed,
          win,
          round,
          transaction,
          outcome: { path, slotIndex, multiplier, outcomeHash },
        })
      : await this.closeLosingRound({
          bet: parsed.bet,
          win,
          round,
          transaction,
          settledBalance: settled.balanceAfter,
        })
    return {
      dropId: parsed.dropId,
      roundId: round.id,
      bet: toMoneyString(parsed.bet),
      risk: parsed.risk,
      rows: parsed.rows,
      path,
      slotIndex,
      multiplier,
      win: toMoneyString(win),
      balance: toMoneyString(balanceAfter),
      currency: session.currency,
      outcomeHash,
      duplicate: false,
    }
  }

  /** Списание ставки + bet-запись + счётчик сессии (вынос из applyDrop, лимит 60 строк). */
  private async settleBet(args: {
    session: GameSessionWithGame
    providerId: string
    parsed: PlinkoDropInput
    betExternalId: string
    round: GameRow
    transaction: WalletTransaction
    outcome: { path: PlinkoPath; slotIndex: number; multiplier: string; outcomeHash: string }
  }): Promise<{ balanceAfter: string }> {
    const { session, providerId, parsed, betExternalId, round, transaction, outcome } = args
    const debitResult = await this.wallet.debit({
      userId: session.userId,
      currency: session.currency as Currency,
      amount: parsed.bet,
      type: 'BET',
      idempotencyKey: `plinkobet_${providerId}_${parsed.dropId}`,
      description: `Ставка Plinko`,
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
        amount: parsed.bet,
        currency: session.currency,
        balanceAfter: debitResult.balanceAfter,
        ledgerEntryId: debitResult.ledgerEntryId,
        metadata: {
          game: PLINKO_EXTERNAL_GAME_ID,
          drop_id: parsed.dropId,
          rows: parsed.rows,
          risk: parsed.risk,
          path: outcome.path,
          slot_index: outcome.slotIndex,
          multiplier: outcome.multiplier,
          outcome_hash: outcome.outcomeHash,
        },
      },
      transaction,
    )
    await this.play.addSessionBet(session.id, parsed.bet, transaction)
    return { balanceAfter: debitResult.balanceAfter }
  }

  /** Начисление выигрыша + win-запись + закрытие раунда (вынос из applyDrop). */
  private async settleWin(args: {
    session: GameSessionWithGame
    providerId: string
    parsed: PlinkoDropInput
    win: string
    round: GameRow
    transaction: WalletTransaction
    outcome: { path: PlinkoPath; slotIndex: number; multiplier: string; outcomeHash: string }
  }): Promise<string> {
    const { session, providerId, parsed, win, round, transaction, outcome } = args
    const { path, slotIndex, multiplier, outcomeHash } = outcome
    const winExternalId = `plinko_${parsed.dropId}_win`
    const creditResult = await this.wallet.credit({
      userId: session.userId,
      currency: session.currency as Currency,
      amount: win,
      type: 'WIN',
      idempotencyKey: `plinkowin_${providerId}_${parsed.dropId}`,
      description: `Выигрыш Plinko`,
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
        amount: win,
        currency: session.currency,
        balanceAfter: creditResult.balanceAfter,
        ledgerEntryId: creditResult.ledgerEntryId,
        metadata: {
          game: PLINKO_EXTERNAL_GAME_ID,
          drop_id: parsed.dropId,
          rows: parsed.rows,
          risk: parsed.risk,
          path,
          slot_index: slotIndex,
          multiplier,
          outcome_hash: outcomeHash,
        },
      },
      transaction,
    )
    await this.play.updateRound(
      round.id,
      { totalBet: parsed.bet, totalWin: win, status: 'closed', closedAt: new Date() },
      transaction,
    )
    await this.play.addSessionWin(session.id, win, transaction)
    return creditResult.balanceAfter
  }

  /** Закрытие проигрышного раунда: win-запись не создаём, исход — в bet-записи. */
  private async closeLosingRound(args: {
    bet: string
    win: string
    round: GameRow
    transaction: WalletTransaction
    settledBalance: string
  }): Promise<string> {
    const { bet, win, round, transaction, settledBalance } = args
    await this.play.updateRound(
      round.id,
      { totalBet: bet, totalWin: win, status: 'closed', closedAt: new Date() },
      transaction,
    )
    return settledBalance
  }

  /**
   * Повторная доставка дропа (ретрай сети): деньги уже проведены.
   * Полный исход восстанавливаем из metadata bet/win-записей,
   * вторую проводку не делаем.
   */
  private async rebuildDuplicateDrop(
    session: GameSessionWithGame,
    providerId: string,
    dropId: string,
  ): Promise<PlinkoDropData> {
    const betRow = await this.play.findTransactionByExternal(providerId, `plinko_${dropId}_bet`)
    const winRow = await this.play.findTransactionByExternal(providerId, `plinko_${dropId}_win`)
    const storedRow = winRow ?? betRow
    if (!storedRow) {
      throw new InvalidBetRequestError()
    }
    const betMeta = (storedRow.metadata ?? {}) as Record<string, unknown>
    const balance = await this.wallet.getBalance(session.userId, session.currency as Currency)
    return this.assembleDropData({
      session,
      dropId,
      bet: betRow ? String(betRow.amount) : '0',
      win: winRow ? String(winRow.amount) : '0',
      roundId: betRow?.roundId ?? null,
      betMeta,
      balance: balance.balance,
    })
  }

  /** Сборка ответа дропа из готовых частей (вынос из rebuildDuplicateDrop, лимит сложности). */
  private assembleDropData(args: {
    session: GameSessionWithGame
    dropId: string
    bet: string
    win: string
    roundId: string | null
    betMeta: Record<string, unknown>
    balance: string
  }): PlinkoDropData {
    const { session, dropId, bet, win, roundId, betMeta, balance } = args
    return {
      dropId,
      roundId,
      bet: toMoneyString(bet),
      risk: (betMeta.risk ?? 'medium') as PlinkoRisk,
      rows: Number(betMeta.rows ?? 16) as PlinkoRows,
      path: (betMeta.path ?? []) as number[],
      slotIndex: Number(betMeta.slot_index ?? 0),
      multiplier: String(betMeta.multiplier ?? '0'),
      win: toMoneyString(win),
      balance: toMoneyString(balance),
      currency: session.currency,
      outcomeHash: String(betMeta.outcome_hash ?? ''),
      duplicate: true,
    }
  }
}
