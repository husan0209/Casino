import { createHash } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'
import { z } from 'zod'

import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { cryptoRandom } from './house-slot-lottery'
import { AZTEC_EXTERNAL_GAME_ID, OriginalsSessionLoader } from './originals-session-loader'
import { TIGER_DEMO_START_CREDIT } from './originals-session.use-case'
import {
  AZTEC_MAX_WIN_MULTIPLIER,
  AZTEC_REEL_ROWS,
  type AztecChainStep,
  playAztecSpin,
} from '../../domain/aztec-game'
import { InvalidBetRequestError } from '../../domain/errors'
import {
  GAME_PLAY_REPOSITORY,
  type GameRow,
  type GameSessionWithGame,
  type GameTransactionRow,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'

/**
 * Вход спина Aztec от собственного клиента: spinId — uuid от фронта
 * (идемпотентность повторной доставки), bet — строка денег.
 */
export const AztecSpinSchema = z.object({
  spinId: z.string().uuid(),
  bet: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, 'bet must be a decimal string')
    .refine((value) => money.isGreaterThan(value, '0'), 'bet must be positive'),
})
export type AztecSpinInput = z.infer<typeof AztecSpinSchema>

export interface AztecSpinRequest {
  sessionToken: string
  spinId: string
  bet: string
}

export interface AztecSpinData {
  spinId: string
  roundId: string | null
  bet: string
  multiplier: string
  win: string
  balance: string
  currency: string
  steps: AztecChainStep[]
  freeSpinsPlayed: number
  capped: boolean
  outcomeHash: string
  duplicate: boolean
}

/** Профиль игры для /state: клиент рисует доску и таблицу по этим данным. */
export interface AztecStateData {
  balance: string
  currency: string
  minBet: string
  maxBet: string
  reelRows: readonly number[]
  maxWinMultiplier: number
  demo: boolean
}

/** Тип Prisma-транзакции из фасада кошелька (прямой импорт prisma в application запрещён). */
type WalletTransaction = Parameters<Parameters<WalletFacade['runInTransaction']>[1]>[0]

/** Тип metadata transaction-записи — выводится из порта, не из Prisma. */
type TransactionMetadata = NonNullable<
  Parameters<IGamePlayRepository['createTransaction']>[0]['metadata']
>

const DEFAULT_MIN_BET = '1'
const DEFAULT_MAX_BET = '10000'

export interface AztecOutcome {
  steps: AztecChainStep[]
  freeSteps: AztecChainStep[]
  freeSpinsPlayed: number
  multiplier: string
  win: string
  capped: boolean
  outcomeHash: string
}

/**
 * Хеш исхода до анимации: клиент получает его вместе с цепочкой и не может
 * «дорисовать» себе выигрыш — цепочка уже зафиксирована в ledger.
 */
export function hashAztecOutcome(spinId: string, steps: AztecChainStep[]): string {
  const canonical = steps.map((step) => `${step.match}:${step.payout}:${step.multiplier}`).join('|')
  return createHash('sha256').update(`${spinId}:${canonical}`).digest('hex')
}

/** Один спин: движок решает цепочку, выплата = ставка × множитель. */
export function rollAztecOutcome(
  parsed: AztecSpinInput,
  randomSource: () => number = cryptoRandom,
): AztecOutcome {
  const spin = playAztecSpin(randomSource)
  const steps = [...spin.steps, ...spin.freeSteps]
  return {
    steps: spin.steps,
    freeSteps: spin.freeSteps,
    freeSpinsPlayed: spin.freeSpinsPlayed,
    multiplier: String(spin.payout),
    win: money.multiply(parsed.bet, String(spin.payout)),
    capped: spin.capped,
    outcomeHash: hashAztecOutcome(parsed.spinId, steps),
  }
}

function toMoneyString(raw: string): string {
  return new Decimal(raw).toString()
}

@Injectable()
export class AztecSpinUseCase {
  constructor(
    @Inject(OriginalsSessionLoader) private readonly sessionLoader: OriginalsSessionLoader,
    @Inject(WalletFacade) private readonly wallet: WalletFacade,
    @Inject(GAME_PLAY_REPOSITORY) private readonly play: IGamePlayRepository,
  ) {}

  async execute(request: AztecSpinRequest): Promise<AztecSpinData> {
    const parsed = AztecSpinSchema.parse({ spinId: request.spinId, bet: request.bet })
    if (this.sessionLoader.isDemoToken(request.sessionToken)) {
      return this.executeDemoSpin(parsed)
    }
    return this.executeRealSpin(request.sessionToken, parsed)
  }

  /** Состояние для клиента: баланс и правила доски. */
  async state(sessionToken: string): Promise<AztecStateData> {
    if (this.sessionLoader.isDemoToken(sessionToken)) {
      return {
        balance: TIGER_DEMO_START_CREDIT,
        currency: 'RUB',
        minBet: DEFAULT_MIN_BET,
        maxBet: DEFAULT_MAX_BET,
        reelRows: AZTEC_REEL_ROWS,
        maxWinMultiplier: AZTEC_MAX_WIN_MULTIPLIER,
        demo: true,
      }
    }
    const session = await this.sessionLoader.loadActiveHouseSession(
      sessionToken,
      AZTEC_EXTERNAL_GAME_ID,
    )
    const balance = await this.wallet.getBalance(session.userId, session.currency as Currency)
    return {
      balance: balance.available,
      currency: session.currency,
      minBet: session.game.minBet === null ? DEFAULT_MIN_BET : String(session.game.minBet),
      maxBet: session.game.maxBet === null ? DEFAULT_MAX_BET : String(session.game.maxBet),
      reelRows: AZTEC_REEL_ROWS,
      maxWinMultiplier: AZTEC_MAX_WIN_MULTIPLIER,
      demo: false,
    }
  }

  private executeDemoSpin(parsed: AztecSpinInput): AztecSpinData {
    const outcome = rollAztecOutcome(parsed)
    const balance = money.add(money.subtract(TIGER_DEMO_START_CREDIT, parsed.bet), outcome.win)
    return this.assemble({
      spinId: parsed.spinId,
      roundId: null,
      parsed,
      outcome,
      balance,
      currency: 'RUB',
    })
  }

  private async executeRealSpin(
    sessionToken: string,
    parsed: AztecSpinInput,
  ): Promise<AztecSpinData> {
    const session = await this.sessionLoader.loadActiveHouseSession(
      sessionToken,
      AZTEC_EXTERNAL_GAME_ID,
    )
    this.assertBetLimits(session, parsed.bet)
    const providerId = session.providerId
    const betExternalId = `aztec_${parsed.spinId}_bet`
    if (await this.play.findTransactionByExternal(providerId, betExternalId)) {
      return this.rebuildDuplicateSpin(session, providerId, parsed.spinId)
    }
    return this.wallet.runInTransaction(
      { userId: session.userId, currency: session.currency as Currency },
      (transaction) => this.applySpin({ session, providerId, parsed, betExternalId, transaction }),
    )
  }

  /** Лимиты ставки из карточки игры, по умолчанию 1..10000. */
  private assertBetLimits(session: GameSessionWithGame, bet: string): void {
    const minBet = session.game.minBet === null ? DEFAULT_MIN_BET : String(session.game.minBet)
    const maxBet = session.game.maxBet === null ? DEFAULT_MAX_BET : String(session.game.maxBet)
    if (money.isGreaterThan(minBet, bet) || money.isGreaterThan(bet, maxBet)) {
      throw new InvalidBetRequestError()
    }
  }

  private async applySpin(args: {
    session: GameSessionWithGame
    providerId: string
    parsed: AztecSpinInput
    betExternalId: string
    transaction: WalletTransaction
  }): Promise<AztecSpinData> {
    const { session, providerId, parsed, betExternalId, transaction } = args
    const race = await this.play.findTransactionByExternal(providerId, betExternalId, transaction)
    if (race) {
      return this.rebuildDuplicateSpin(session, providerId, parsed.spinId)
    }
    const outcome = rollAztecOutcome(parsed)
    const round = await this.openSpinRound({ session, providerId, parsed, transaction })
    const balance = await this.settleSpin({
      session,
      providerId,
      parsed,
      betExternalId,
      round,
      transaction,
      outcome,
    })
    return this.assemble({
      spinId: parsed.spinId,
      roundId: round.id,
      parsed,
      outcome,
      balance,
      currency: session.currency,
    })
  }

  private async openSpinRound(args: {
    session: GameSessionWithGame
    providerId: string
    parsed: AztecSpinInput
    transaction: WalletTransaction
  }): Promise<GameRow> {
    const { session, providerId, parsed, transaction } = args
    return this.play.createRound(
      {
        sessionId: session.id,
        userId: session.userId,
        gameId: session.gameId,
        providerId,
        externalRoundId: `aztec_${parsed.spinId}`,
        currency: session.currency,
        status: 'open',
      },
      transaction,
    )
  }

  private async settleSpin(args: {
    session: GameSessionWithGame
    providerId: string
    parsed: AztecSpinInput
    betExternalId: string
    round: GameRow
    transaction: WalletTransaction
    outcome: AztecOutcome
  }): Promise<string> {
    const { session, providerId, parsed, betExternalId, round, transaction, outcome } = args
    const debit = await this.wallet.debit({
      userId: session.userId,
      currency: session.currency as Currency,
      amount: parsed.bet,
      type: 'BET',
      idempotencyKey: `aztecbet_${providerId}_${parsed.spinId}`,
      description: 'Ставка Aztec',
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
        balanceAfter: debit.balanceAfter,
        ledgerEntryId: debit.ledgerEntryId,
        metadata: this.spinMetadata(parsed, outcome),
      },
      transaction,
    )
    await this.play.addSessionBet(session.id, parsed.bet, transaction)
    if (!money.isPositive(outcome.win)) {
      await this.play.updateRound(
        round.id,
        { totalBet: parsed.bet, totalWin: outcome.win, status: 'closed', closedAt: new Date() },
        transaction,
      )
      return debit.balanceAfter
    }
    return this.settleWin({ session, providerId, parsed, round, transaction, outcome })
  }

  private async settleWin(args: {
    session: GameSessionWithGame
    providerId: string
    parsed: AztecSpinInput
    round: GameRow
    transaction: WalletTransaction
    outcome: AztecOutcome
  }): Promise<string> {
    const { session, providerId, parsed, round, transaction, outcome } = args
    const credit = await this.wallet.credit({
      userId: session.userId,
      currency: session.currency as Currency,
      amount: outcome.win,
      type: 'WIN',
      idempotencyKey: `aztecwin_${providerId}_${parsed.spinId}`,
      description: 'Выигрыш Aztec',
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
        externalTransactionId: `aztec_${parsed.spinId}_win`,
        amount: outcome.win,
        currency: session.currency,
        balanceAfter: credit.balanceAfter,
        ledgerEntryId: credit.ledgerEntryId,
        metadata: this.spinMetadata(parsed, outcome),
      },
      transaction,
    )
    await this.play.updateRound(
      round.id,
      { totalBet: parsed.bet, totalWin: outcome.win, status: 'closed', closedAt: new Date() },
      transaction,
    )
    await this.play.addSessionWin(session.id, outcome.win, transaction)
    return credit.balanceAfter
  }

  /**
   * Повторная доставка спина (ретрай сети): деньги уже проведены, вторую
   * проводку не делаем — ответ собираем из metadata bet/win-записей.
   */
  private async rebuildDuplicateSpin(
    session: GameSessionWithGame,
    providerId: string,
    spinId: string,
  ): Promise<AztecSpinData> {
    const betRow = await this.play.findTransactionByExternal(providerId, `aztec_${spinId}_bet`)
    const winRow = await this.play.findTransactionByExternal(providerId, `aztec_${spinId}_win`)
    const stored = winRow ?? betRow
    if (!stored) {
      throw new InvalidBetRequestError()
    }
    const balance = await this.wallet.getBalance(session.userId, session.currency as Currency)
    return this.assembleStoredSpin({
      session,
      spinId,
      betRow,
      winRow,
      stored,
      balance: balance.available,
    })
  }

  /** Ответ повторной доставки из уже проведённых записей (вынос из rebuild). */
  private assembleStoredSpin(args: {
    session: GameSessionWithGame
    spinId: string
    betRow: GameTransactionRow | null
    winRow: GameTransactionRow | null
    stored: GameTransactionRow
    balance: string
  }): AztecSpinData {
    const { session, spinId, betRow, winRow, stored, balance } = args
    const meta = (stored.metadata ?? {}) as Record<string, unknown>
    return {
      spinId,
      roundId: betRow?.roundId ?? null,
      bet: toMoneyString(betRow ? String(betRow.amount) : '0'),
      multiplier: String(meta.multiplier ?? '0'),
      win: toMoneyString(winRow ? String(winRow.amount) : '0'),
      balance: toMoneyString(balance),
      currency: session.currency,
      steps: (meta.steps ?? []) as AztecChainStep[],
      freeSpinsPlayed: Number(meta.free_spins_played ?? 0),
      capped: meta.capped === true,
      outcomeHash: String(meta.outcome_hash ?? ''),
      duplicate: true,
    }
  }

  private spinMetadata(parsed: AztecSpinInput, outcome: AztecOutcome): TransactionMetadata {
    return {
      game: AZTEC_EXTERNAL_GAME_ID,
      spin_id: parsed.spinId,
      multiplier: outcome.multiplier,
      steps: [...outcome.steps, ...outcome.freeSteps],
      free_spins_played: outcome.freeSpinsPlayed,
      capped: outcome.capped,
      outcome_hash: outcome.outcomeHash,
    }
  }

  private assemble(args: {
    spinId: string
    roundId: string | null
    parsed: AztecSpinInput
    outcome: AztecOutcome
    balance: string
    currency: string
  }): AztecSpinData {
    const { spinId, roundId, parsed, outcome, balance, currency } = args
    return {
      spinId,
      roundId,
      bet: toMoneyString(parsed.bet),
      multiplier: outcome.multiplier,
      win: toMoneyString(outcome.win),
      balance: toMoneyString(balance),
      currency,
      steps: outcome.steps,
      freeSpinsPlayed: outcome.freeSpinsPlayed,
      capped: outcome.capped,
      outcomeHash: outcome.outcomeHash,
      duplicate: false,
    }
  }
}
