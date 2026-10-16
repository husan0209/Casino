import { randomBytes } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'
import { z } from 'zod'

import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import {
  buildHouseSlotLottery,
  cryptoRandom,
  drawHouseSlotOutcome,
  houseSlotRtpCeiling,
} from './house-slot-lottery'
import { DEMO_TOKEN_PREFIX, OriginalsSessionLoader } from './originals-session-loader'
import { TIGER_DEMO_START_CREDIT } from './originals-session.use-case'
import { DEMO_BALANCE_STORE, type IDemoBalanceStore } from '../../domain/demo-balance'
import { InsufficientFundsError, InvalidBetRequestError } from '../../domain/errors'
import {
  type DonorAmount,
  houseRowBaseLinesPayout,
  houseRowPayout,
  HOUSE_SLOT_MAX_PAYLINES,
  type HouseSlotGameConfig,
} from '../../domain/house-slot-game'
import {
  GAME_CATALOG_REPOSITORY,
  GAME_PLAY_REPOSITORY,
  type GameRow,
  type GameSessionWithGame,
  type IGameCatalogRepository,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'
import { demoRtpPercent, engagementRtpPercent, moneyRtpPercent } from '../../domain/rtp-policy'
import {
  TIGER_ROW_INDEX,
  TigerSpinRowSchema,
  type TigerSpinRow,
} from '../../infrastructure/providers/house/spin-data/tiger-spin-row'
import {
  EngagementEngineService,
  type MechanicsResult,
  type PreparedSpin,
} from '../services/engagement-engine.service'

/**
 * Вход спина от фронта Construct 3 (x-www-form-urlencoded):
 * betamount/numline/cpl. Деньги — строками, целые — строками целых.
 * Потолок numline = HOUSE_SLOT_MAX_PAYLINES: клиент сам решает линиями (Tiger 5,
 * потолок 20 — максимум из наблюдаемых клиентов донора (Tiger шлёт 5, Jack Frost и
 * Aztec — 20); калибровка RTP идёт по этому же числу.
 */
export const OriginalsSpinSchema = z.object({
  betamount: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, 'betamount must be a decimal string')
    .refine((value) => money.isGreaterThan(value, '0'), 'betamount must be positive')
    .refine((value) => !money.isGreaterThan(value, '1000'), 'betamount is too large'),
  numline: z.coerce.number().int().min(1).max(HOUSE_SLOT_MAX_PAYLINES).transform(String),
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
  HasNewSpawn: boolean
  HasPlaceHolder: boolean
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
  betamount: DonorAmount
  bet_amount: DonorAmount
  pull: TigerSpinPull
}

/** Тип Prisma-транзакции из фасада кошелька (прямой импорт prisma в application запрещён). */
type WalletTransaction = Parameters<Parameters<WalletFacade['runInTransaction']>[1]>[0]

function toFrontMoney(amount: string): number {
  return new Decimal(amount).toDecimalPlaces(2).toNumber()
}

/**
 * RTP демо-спина: цель админа из `rtp_demo` (или щедрые 120 по умолчанию),
 * но не выше потолка таблиц игры. В демо нет строки сессии, а просить у узких
 * таблиц (Ox/Panda ~90 %) 120 % означало бы ошибку на каждом спине.
 */
function demoRtpFor(game: HouseSlotGameConfig, paylines: number, rtpDemo: unknown): string {
  const winPayouts = game.winRows.map((row) => houseRowPayout(row, game.payoutModel))
  return demoRtpPercent(rtpDemo, houseSlotRtpCeiling(winPayouts, paylines))
}

@Injectable()
export class OriginalsSpinUseCase {
  constructor(
    @Inject(OriginalsSessionLoader) private readonly sessionLoader: OriginalsSessionLoader,
    @Inject(WalletFacade) private readonly wallet: WalletFacade,
    @Inject(GAME_PLAY_REPOSITORY) private readonly play: IGamePlayRepository,
    @Inject(GAME_CATALOG_REPOSITORY) private readonly catalog: IGameCatalogRepository,
    @Inject(DEMO_BALANCE_STORE) private readonly demoBalance: IDemoBalanceStore,
    @Inject(EngagementEngineService) private readonly engagement: EngagementEngineService,
  ) {}

  async execute(request: TigerSpinRequest): Promise<TigerSpinData> {
    const parsed = OriginalsSpinSchema.parse({
      betamount: request.betamount,
      numline: request.numline,
      cpl: request.cpl,
    })
    const betTotal = money.multiply(money.multiply(parsed.betamount, parsed.cpl), parsed.numline)
    if (request.sessionToken.startsWith(DEMO_TOKEN_PREFIX)) {
      return this.executeDemoSpin(request.sessionToken, parsed, betTotal)
    }
    return this.executeRealSpin(request.sessionToken, parsed, betTotal)
  }

  /**
   * Лотерея калибруется по ФАКТИЧЕСКОму числу линий этого спина: ставка =
   * bet*cpl*numline, выплата от numline не зависит, поэтому знаменатель RTP
   * обязан быть тем же, что и в ставке. Иначе игрок крутит 1 линией и получает
   * x5 к отдаче (на этом донор и стоял: 527% у Tiger).
   */
  private drawOutcome(
    game: HouseSlotGameConfig,
    targetRtpPercent: string,
    paylines: number,
  ): TigerSpinRow {
    const lottery = buildHouseSlotLottery({
      gameCode: game.externalGameId,
      winPayouts: game.winRows.map((row) => houseRowPayout(row, game.payoutModel)),
      targetRtp: targetRtpPercent,
      paylines,
    })
    return drawHouseSlotOutcome({
      lottery,
      winRows: game.winRows,
      loseRows: game.loseRows,
      random: cryptoRandom,
    })
  }

  /** Выигрыш спина: payout строки (по модели игры) на cpl * betamount. */
  private winTotalFor(
    game: HouseSlotGameConfig,
    parsed: OriginalsSpinInput,
    outcome: TigerSpinRow,
  ): string {
    const payout = houseRowPayout(outcome, game.payoutModel)
    return money.multiply(money.multiply(parsed.betamount, parsed.cpl), String(payout))
  }

  private async executeDemoSpin(
    sessionToken: string,
    parsed: OriginalsSpinInput,
    betTotal: string,
  ): Promise<TigerSpinData> {
    const game = this.sessionLoader.loadDemoSlotGame(sessionToken)
    const paylines = Number(parsed.numline)
    const card = await this.catalog.findByExternalGameId(game.externalGameId)
    const outcome = this.drawOutcome(game, demoRtpFor(game, paylines, card?.rtpDemo), paylines)
    const winTotal = this.winTotalFor(game, parsed, outcome)
    // Остаток ведётся на счёту сессии: без этого спин считался бы от стартовых
    // 1000, выигрыши не копились, а ставка больше старта уводила демо в минус.
    const settled = await this.demoBalance.settle({
      sessionToken,
      startCredit: TIGER_DEMO_START_CREDIT,
      bet: betTotal,
      win: winTotal,
    })
    if (!settled.accepted) {
      throw new InsufficientFundsError(betTotal, settled.balance)
    }
    return this.buildSpinData({
      credit: settled.balance,
      game,
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
    const paylines = Number(parsed.numline)
    // §9.1 шаги 1–2: состояние движка и решение о реактивации — до лотереи,
    // потому что кредит реактивации меняет баланс, а RTP выбирается под фазу.
    const prepared = await this.prepareEngagement(session, game, paylines)

    // §9.1 шаги 3–6: RTP спина, розыгрыш, затем подмена исхода механиками.
    const spin = this.applyEngagementMechanics({ session, game, paylines, prepared })
    const { outcome, isLdw, isNearMiss } = spin

    const winTotal = this.winTotalFor(game, parsed, outcome)
    const round = await this.openRound({ session, providerId, roundExternalId, transaction })
    const balanceAfter = await this.settleRound({
      session,
      game,
      providerId,
      betTotal,
      betExternalId,
      winTotal,
      round,
      roundExternalId,
      transaction,
    })

    // §4.3 и §6.2: кредит реактивации и запись состояния — после проводок,
    // когда итоговый баланс известен. Обе операции в той же транзакции.
    const finalBalance = await this.finishEngagement({
      session,
      game,
      providerId,
      round,
      roundExternalId,
      prepared,
      betTotal,
      winTotal,
      isLdw,
      isNearMiss,
      mechanicsEvents: spin.pendingEvents,
      balanceAfter,
      transaction,
    })

    return this.buildSpinData({
      credit: finalBalance,
      game,
      parsed,
      betTotal,
      winTotal,
      outcome,
    })
  }

  /** Раунд целиком: списание ставки и зачисление выигрыша (или закрытие пустого). */
  private async settleRound(args: {
    session: GameSessionWithGame
    game: HouseSlotGameConfig
    providerId: string
    betTotal: string
    betExternalId: string
    winTotal: string
    round: GameRow
    roundExternalId: string
    transaction: WalletTransaction
  }): Promise<string> {
    const settled = await this.settleBet({
      session: args.session,
      game: args.game,
      providerId: args.providerId,
      betTotal: args.betTotal,
      betExternalId: args.betExternalId,
      round: args.round,
      transaction: args.transaction,
    })
    if (money.isPositive(args.winTotal)) {
      return this.settleWin({
        session: args.session,
        game: args.game,
        providerId: args.providerId,
        betTotal: args.betTotal,
        winTotal: args.winTotal,
        round: args.round,
        roundExternalId: args.roundExternalId,
        transaction: args.transaction,
      })
    }
    return this.closeLosingRound({
      betTotal: args.betTotal,
      round: args.round,
      transaction: args.transaction,
      settledBalance: settled.balanceAfter,
    })
  }

  /**
   * §9.1 шаги 3–6 — RTP спина под фазу, розыгрыш и подмена исхода механиками.
   * Движок выключен или недоступен — спин идёт по базовой ветке без изменений.
   */
  private applyEngagementMechanics(args: {
    session: GameSessionWithGame
    game: HouseSlotGameConfig
    paylines: number
    prepared: PreparedSpin | null
  }): {
    outcome: TigerSpinRow
    isLdw: boolean
    isNearMiss: boolean
    pendingEvents: MechanicsResult['pendingEvents']
  } {
    const { session, game, paylines, prepared } = args
    const targetRtp =
      prepared?.rtpPercent !== null && prepared?.rtpPercent !== undefined
        ? engagementRtpPercent(prepared.rtpPercent)
        : moneyRtpPercent(session.game.rtp)
    const drawn = this.drawOutcome(game, targetRtp, paylines)
    if (!prepared) {
      return { outcome: drawn, isLdw: false, isNearMiss: false, pendingEvents: [] }
    }
    const mechanics = this.engagement.applyMechanics({
      prepared,
      winRows: game.winRows,
      payoutModel: game.payoutModel,
    })
    if (!mechanics.row) {
      return {
        outcome: drawn,
        isLdw: false,
        isNearMiss: false,
        pendingEvents: mechanics.pendingEvents,
      }
    }
    return {
      outcome: mechanics.row,
      isLdw: mechanics.isLdw,
      isNearMiss: mechanics.isNearMiss,
      pendingEvents: mechanics.pendingEvents,
    }
  }

  /**
   * Кредит реактивации (§4.3) и запись состояния движка (§6.2).
   * Кредит идёт с идемпотентным ключом от `roundExternalId` — иначе повторный
   * запрос по токену удвоил бы бонус.
   */
  private async finishEngagement(args: {
    session: GameSessionWithGame
    game: HouseSlotGameConfig
    providerId: string
    round: GameRow
    roundExternalId: string
    prepared: PreparedSpin | null
    betTotal: string
    winTotal: string
    isLdw: boolean
    isNearMiss: boolean
    /** §11.3 — события механик спина (`ldw_applied` / `near_miss_applied`). */
    mechanicsEvents: MechanicsResult['pendingEvents']
    balanceAfter: string
    transaction: WalletTransaction
  }): Promise<string> {
    const { session, game, providerId, round, roundExternalId, prepared, transaction } = args
    if (!prepared) {
      return args.balanceAfter
    }
    const credit = prepared.reactivation?.trigger ? prepared.reactivation.creditAmount : '0'
    let balance = args.balanceAfter
    if (money.isPositive(credit)) {
      balance = await this.settleReactivation({
        session,
        game,
        providerId,
        round,
        roundExternalId,
        amount: credit,
        transaction,
      })
    }
    await this.engagement.track({
      prepared,
      sessionId: session.id,
      bet: args.betTotal,
      win: args.winTotal,
      currentBalance: balance,
      isLdw: args.isLdw,
      isNearMiss: args.isNearMiss,
      reactivationCredit: credit,
      mechanicsEvents: args.mechanicsEvents,
    })
    return balance
  }

  /**
   * §9.1 шаг 1–2 — состояние и реактивация. Движок выключен по умолчанию
   * (ENGAGEMENT_ENABLED), в демо не включается никогда (§17), тогда весь шаг
   * возвращает null и спин идёт по базовой ветке без изменений.
   */
  private async prepareEngagement(
    session: GameSessionWithGame,
    game: HouseSlotGameConfig,
    paylines: number,
  ): Promise<PreparedSpin | null> {
    if (!this.engagement.isEnabledFor(session.userId, session.isDemo)) {
      return null
    }
    const currency = session.currency as Currency
    const balance = await this.wallet.getBalance(session.userId, currency)
    const winPayouts = game.winRows.map((row) => houseRowPayout(row, game.payoutModel))
    return this.engagement.prepare({
      userId: session.userId,
      gameId: session.gameId,
      sessionId: session.id,
      currency,
      currentBalance: balance.balance,
      baseRtpPercent: Number(moneyRtpPercent(session.game.rtp)),
      tableCeilingPercent: winPayouts.length > 0 ? houseSlotRtpCeiling(winPayouts, paylines) : null,
    })
  }

  /**
   * §4.3 — кредит бонуса реактивации. Проводка BONUS в ledger и game-транзакция
   * типа win, привязанные к тому же раунду: бонус — это выплата казино, поэтому
   * он должен попадать в отчётность по игре, а не висеть отдельной строкой.
   */
  private async settleReactivation(args: {
    session: GameSessionWithGame
    game: HouseSlotGameConfig
    providerId: string
    round: GameRow
    roundExternalId: string
    amount: string
    transaction: WalletTransaction
  }): Promise<string> {
    const { session, game, providerId, round, roundExternalId, amount, transaction } = args
    const externalId = `${roundExternalId}_reactivation`
    const credit = await this.wallet.credit({
      userId: session.userId,
      currency: session.currency as Currency,
      amount,
      type: 'BONUS',
      idempotencyKey: `${game.externalGameId}reactivation_${providerId}_${externalId}`,
      description: `Бонус реактивации ${game.displayName}`,
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
        externalTransactionId: externalId,
        amount,
        currency: session.currency,
        balanceAfter: credit.balanceAfter,
        ledgerEntryId: credit.ledgerEntryId,
        metadata: { game: game.externalGameId, source: 'engagement_reactivation' },
      },
      transaction,
    )
    return credit.balanceAfter
  }

  /** Открытие раунда до проводок (вынос из applySpin, лимит 60 строк). */
  private async openRound(args: {
    session: GameSessionWithGame
    providerId: string
    roundExternalId: string
    transaction: WalletTransaction
  }): Promise<GameRow> {
    const { session, providerId, roundExternalId, transaction } = args
    return this.play.createRound(
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
      game,
      parsed,
      betTotal,
      winTotal: '0',
      outcome: fallbackRow,
    })
  }

  /**
   * Форма ответа донора зависит от модели выплаты:
   * - `single` (одна линия, payout в row[5]): вся сумма ложится на единственную
   *   линию, TotalWay 27 и DropLine 3 — стабы донора, на них фронт работает;
   * - `lines` (3x5 игры): деньги пишутся на КАЖДУЮ линию (payout × cpl ×
   *   betamount), WinOnDrop считает только базовые линии без каскадов,
   *   TotalWay 243 при выигрыше, DropLine — число каскадов в строке.
   *   Зеркалит public/originals/queenofbounty/api/endpoints/spin.php.
   */
  private buildSpinData(args: {
    credit: string
    game: HouseSlotGameConfig
    parsed: OriginalsSpinInput
    betTotal: string
    winTotal: string
    outcome: TigerSpinRow
  }): TigerSpinData {
    const { credit, game, parsed, betTotal, winTotal, outcome } = args
    const validated: TigerSpinRow = TigerSpinRowSchema.parse(outcome)
    const multiLine = game.payoutModel === 'lines'
    const stake = money.multiply(parsed.betamount, parsed.cpl)
    const lines = validated[TIGER_ROW_INDEX.activeLines]
    const dropLines = validated[TIGER_ROW_INDEX.dropLineData]
    const activeLines = lines.map((line) => ({
      ...line,
      win_amount: toFrontMoney(multiLine ? money.multiply(stake, String(line.payout)) : winTotal),
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
        TotalWay: multiLine ? (money.isPositive(winTotal) ? 243 : 0) : 27,
        FreeSpin: 0,
        LastMultiply: 0,
        WildFixedIcons: [],
        HasJackpot: false,
        HasScatter: false,
        CountScatter: 0,
        WildColumIcon: '',
        MultipyScatter: 0,
        MultiplyCount: multiLine ? validated[TIGER_ROW_INDEX.multiplyCount] : 2,
        WinLogs: this.buildWinLogs(parsed, betTotal, winTotal, validated),
        DropLine: multiLine ? dropLines.length : 3,
        MultipleList: [],
        WinAmount: toFrontMoney(winTotal),
        WinOnDrop: toFrontMoney(
          multiLine ? money.multiply(stake, String(houseRowBaseLinesPayout(validated))) : winTotal,
        ),
        HasNewSpawn: multiLine && dropLines.length > 0,
        HasPlaceHolder: false,
        SlotIcons: validated[TIGER_ROW_INDEX.slotIcons],
        ActiveIcons: validated[TIGER_ROW_INDEX.activeIcons],
        ActiveLines: activeLines,
        DropLineData: dropLines,
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
