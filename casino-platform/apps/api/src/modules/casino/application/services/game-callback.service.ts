import { Inject, Injectable } from '@nestjs/common'

import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type CreditResult, type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import {
  InvalidBetRequestError,
  InvalidRollbackRequestError,
  InvalidWinRequestError,
  PlayerBlockedError,
  RollbackOfRollbackError,
  SessionInvalidError,
} from '../../domain/errors'
import {
  type ParsedProviderCallback,
  type ProviderCallbackResponse,
} from '../../domain/provider-adapter.interface'
import {
  GAME_PLAY_REPOSITORY,
  type GameRow,
  type GameSessionWithGame,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'

/**
 * Prisma-клиент транзакции, который отдаёт WalletFacade.runInTransaction.
 * Прямой импорт prisma в application запрещён (гард G1), а тип выводится из
 * фасада — единственного публичного входа wallet для других модулей.
 */
type WalletTx = Parameters<Parameters<WalletFacade['runInTransaction']>[1]>[0]

interface AuthenticateResult {
  player_id: string
  currency: string
  balance: string
  nickname: string
  operator_session: string
}

@Injectable()
export class GameCallbackService {
  constructor(
    @Inject(WalletFacade) private wallet: WalletFacade,
    @Inject(GAME_PLAY_REPOSITORY) private readonly play: IGamePlayRepository,
  ) {}

  /** Стандартный seamless-ответ провайдеру (формат GitSlotPark). */
  async authenticate(sessionToken: string): Promise<AuthenticateResult> {
    const session = await this.play.findSessionByTokenWithUser(sessionToken)
    if (session?.status !== 'active') {
      throw new SessionInvalidError()
    }
    if (session.user.status !== 'active') {
      throw new PlayerBlockedError()
    }
    await this.play.touchSession(session.id)
    const balance = await this.getWalletBalance(session.userId, session.currency)
    return {
      player_id: session.userId,
      currency: session.currency,
      balance,
      nickname: session.user.email || session.user.id.slice(0, 8),
      operator_session: session.id,
    }
  }

  async balance(sessionToken: string): Promise<{ balance: string; currency: string }> {
    const a = await this.authenticate(sessionToken)
    return { balance: a.balance, currency: a.currency }
  }

  async bet(cb: ParsedProviderCallback, providerId: string): Promise<ProviderCallbackResponse> {
    if (!cb.playerToken || !cb.transactionId || !cb.betAmount) {
      throw new InvalidBetRequestError()
    }
    const session = await this.findActiveSession(cb.playerToken)
    const dup = await this.play.findTransactionByExternal(providerId, cb.transactionId)
    if (dup) {
      return this.duplicateResponse(session)
    }
    // сужаем типы до замыкания (внутри колбэка narrowing не работает)
    const externalId = cb.transactionId!
    const betAmount = cb.betAmount!
    // P0 #3: ledger-запись и gameTransaction в одной $transaction — краш между
    // операциями больше не оставляет деньги без записи (или наоборот).
    // GAP-57: target — кошелёк игрока; по нему транзакция сериализуется.
    return this.wallet.runInTransaction(
      { userId: session.userId, currency: session.currency as Currency },
      (tx) => this.applyBet({ cb, providerId, session, externalId, betAmount, tx }),
    )
  }

  /** Тело bet внутри транзакции (вынос из bet — GAP-57, лимит 60 строк). */
  private async applyBet(args: {
    cb: ParsedProviderCallback
    providerId: string
    session: GameSessionWithGame
    externalId: string
    betAmount: string
    tx: WalletTx
  }): Promise<ProviderCallbackResponse> {
    const { cb, providerId, session, externalId, betAmount, tx } = args
    // повторная проверка дубликата внутри транзакции (гонка двух одновременных bet)
    const dupInTx = await this.play.findTransactionByExternal(providerId, externalId, tx)
    if (dupInTx) {
      return this.duplicateResponse(session)
    }
    const round = await this.findOrCreateRound({
      providerId,
      cb,
      session,
      initialStatus: 'open',
      tx,
    })
    const creditRes = await this.wallet.debit({
      userId: session.userId,
      currency: session.currency as Currency,
      amount: betAmount,
      type: 'BET',
      idempotencyKey: `bet_${providerId}_${externalId}`,
      description: `Ставка в ${session.game.name}`,
      metadata: {
        provider_id: providerId,
        game_id: session.gameId,
        round_id: round.id,
        external_transaction_id: externalId,
      },
      tx,
    })
    await this.recordGameTransaction({
      roundId: round.id,
      session,
      providerId,
      type: 'bet',
      externalId,
      amount: betAmount,
      balanceAfter: creditRes.balanceAfter,
      ledgerEntryId: creditRes.ledgerEntryId,
      raw: cb.rawRequest,
      tx,
    })
    await this.play.updateRound(round.id, { totalBet: { increment: betAmount } }, tx)
    await this.play.addSessionBet(session.id, betAmount, tx)
    return { balance: creditRes.balanceAfter, duplicate: false }
  }

  async win(cb: ParsedProviderCallback, providerId: string): Promise<ProviderCallbackResponse> {
    if (!cb.playerToken || !cb.transactionId) {
      throw new InvalidWinRequestError()
    }
    const session = await this.play.findSessionByTokenWithGame(cb.playerToken)
    if (!session) {
      throw new SessionInvalidError()
    }
    const dup = await this.play.findTransactionByExternal(providerId, cb.transactionId)
    if (dup) {
      return this.duplicateResponse(session)
    }
    const winAmount = cb.winAmount || '0'
    // P0 #3: атомарно — credit + gameTransaction + закрытие раунда.
    // GAP-57: target — кошелёк игрока (тот же, что у bet).
    return this.wallet.runInTransaction(
      { userId: session.userId, currency: session.currency as Currency },
      (tx) => this.applyWin({ cb, providerId, session, winAmount, tx }),
    )
  }

  /** Тело win внутри транзакции (вынос из win — GAP-57, лимит 60 строк). */
  private async applyWin(args: {
    cb: ParsedProviderCallback
    providerId: string
    session: GameSessionWithGame
    winAmount: string
    tx: WalletTx
  }): Promise<ProviderCallbackResponse> {
    const { cb, providerId, session, winAmount, tx } = args
    const dupInTx = await this.play.findTransactionByExternal(providerId, cb.transactionId!, tx)
    if (dupInTx) {
      return this.duplicateResponse(session)
    }
    const round = await this.findOrCreateRound({
      providerId,
      cb,
      session,
      initialStatus: 'closed',
      tx,
    })
    let balanceAfter = '0'
    let ledgerEntryId: string | null = null
    const isWin = money.isPositive(winAmount)
    if (isWin) {
      const res = await this.creditWin({ session, providerId, cb, winAmount, tx })
      balanceAfter = res.balanceAfter
      ledgerEntryId = res.ledgerEntryId
    } else {
      balanceAfter = await this.getWalletBalance(session.userId, session.currency)
    }
    await this.recordGameTransaction({
      roundId: round.id,
      session,
      providerId,
      type: 'win',
      externalId: cb.transactionId!,
      amount: winAmount,
      balanceAfter,
      ledgerEntryId,
      raw: cb.rawRequest,
      tx,
    })
    if (isWin) {
      await this.play.updateRound(
        round.id,
        { totalWin: { increment: winAmount }, status: 'closed', closedAt: new Date() },
        tx,
      )
      await this.play.addSessionWin(session.id, winAmount, tx)
    }
    return { balance: balanceAfter, duplicate: false }
  }

  async rollback(
    cb: ParsedProviderCallback,
    providerId: string,
  ): Promise<ProviderCallbackResponse> {
    if (!cb.playerToken || !cb.rollbackTransactionId) {
      throw new InvalidRollbackRequestError()
    }
    const session = await this.play.findSessionByToken(cb.playerToken)
    if (!session) {
      throw new SessionInvalidError()
    }
    const originalTx = await this.play.findTransactionByExternal(
      providerId,
      cb.rollbackTransactionId,
    )
    if (!originalTx) {
      // phantom rollback – return current balance
      return {
        balance: await this.getWalletBalance(session.userId, session.currency),
        phantom: true,
      }
    }
    const already = await this.play.findRollbackOf(originalTx.roundId, originalTx.id)
    if (already) {
      return this.duplicateResponse(session)
    }
    const rollbackAmount = originalTx.amount.toString()
    if (originalTx.type === 'rollback') {
      throw new RollbackOfRollbackError()
    }
    // Reverse the ORIGINAL effect: a bet (debit) is refunded with a credit;
    // a win (credit) is taken back with a debit. Without this, rolling back a
    // win would pay the win amount a second time.
    const isBet = originalTx.type === 'bet'
    // P0 #3: атомарно — компенсирующая проводка + rollback-запись + раунд.
    // GAP-57: target — кошелёк игрока (компенсация трогает те же деньги).
    return this.wallet.runInTransaction(
      { userId: session.userId, currency: session.currency as Currency },
      (tx) =>
        this.applyRollback({ cb, providerId, session, originalTx, rollbackAmount, isBet, tx }),
    )
  }

  /** Компенсирующая проводка + rollback-запись + раунд внутри tx (вынос из rollback, GAP-30). */
  private async applyRollback(args: {
    cb: ParsedProviderCallback
    providerId: string
    session: { id: string; userId: string; currency: string }
    originalTx: { id: string; roundId: string; externalTransactionId: string }
    rollbackAmount: string
    isBet: boolean
    /* Тип tx выводим из фасада — прямой импорт prisma в application запрещён (G1) */
    tx: WalletTx
  }): Promise<ProviderCallbackResponse> {
    const { cb, providerId, session, originalTx, rollbackAmount, isBet, tx } = args
    // гонка двух одновременных rollback — перепроверка внутри транзакции
    const alreadyInTx = await this.play.findRollbackOf(originalTx.roundId, originalTx.id, tx)
    if (alreadyInTx) {
      return this.duplicateResponse(session)
    }
    const entry = {
      userId: session.userId,
      currency: session.currency as Currency,
      amount: rollbackAmount,
      type: 'ROLLBACK' as const,
      idempotencyKey: `rollback_${providerId}_${cb.transactionId || originalTx.id}`,
      metadata: { rollback_of: originalTx.id },
      tx,
    }
    const res = isBet
      ? await this.wallet.credit({ ...entry, description: 'Отмена ставки' })
      : await this.wallet.debit({ ...entry, description: 'Отмена выигрыша' })
    await this.play.createTransaction(
      {
        roundId: originalTx.roundId,
        sessionId: session.id,
        userId: session.userId,
        providerId,
        type: 'rollback',
        externalTransactionId: cb.transactionId || `rb_${originalTx.externalTransactionId}`,
        amount: rollbackAmount,
        currency: session.currency,
        balanceAfter: res.balanceAfter,
        ledgerEntryId: res.ledgerEntryId,
        metadata: { ...(cb.rawRequest ?? {}), rollback_of: originalTx.id },
      },
      tx,
    )
    await this.play.updateRound(
      originalTx.roundId,
      {
        totalBet: { decrement: rollbackAmount },
        status: 'rolled_back',
      },
      tx,
    )
    return { balance: res.balanceAfter }
  }

  /** Активная сессия с игрой — общий вход bet/win. */
  private async findActiveSession(token: string): Promise<GameSessionWithGame> {
    const session = await this.play.findSessionByTokenWithGame(token)
    if (session?.status !== 'active') {
      throw new SessionInvalidError()
    }
    return session
  }

  /** Повторный колбэк: отдаём баланс, вторую проводку не делаем. */
  private async duplicateResponse(session: {
    userId: string
    currency: string
  }): Promise<ProviderCallbackResponse> {
    return {
      balance: await this.getWalletBalance(session.userId, session.currency),
      duplicate: true,
    }
  }

  /** gameTransaction — зеркало провайдерской операции раунда (вынос из bet/win). */
  private async recordGameTransaction(args: {
    roundId: string
    session: { id: string; userId: string; currency: string }
    providerId: string
    type: 'bet' | 'win'
    externalId: string
    amount: string
    balanceAfter: string
    ledgerEntryId: string | null
    raw: ParsedProviderCallback['rawRequest']
    tx: WalletTx
  }): Promise<void> {
    const { roundId, session, providerId, type, externalId, amount, balanceAfter, raw, tx } = args
    await this.play.createTransaction(
      {
        roundId,
        sessionId: session.id,
        userId: session.userId,
        providerId,
        type,
        externalTransactionId: externalId,
        amount,
        currency: session.currency,
        balanceAfter,
        ledgerEntryId: args.ledgerEntryId,
        metadata: raw ?? {},
      },
      tx,
    )
  }

  private async findOrCreateRound(args: {
    providerId: string
    cb: ParsedProviderCallback
    session: GameSessionWithGame
    initialStatus: 'open' | 'closed'
    tx?: WalletTx
  }): Promise<GameRow> {
    const { providerId, cb, session, initialStatus, tx } = args
    const roundExternalId = cb.roundId || cb.transactionId!
    const existing = await this.play.findRoundByExternal(providerId, roundExternalId, tx)
    if (existing) {
      return existing
    }
    return this.play.createRound(
      {
        sessionId: session.id,
        userId: session.userId,
        gameId: session.gameId,
        providerId,
        externalRoundId: roundExternalId,
        currency: session.currency,
        status: initialStatus,
        ...(initialStatus === 'closed' ? { closedAt: new Date() } : {}),
      },
      tx,
    )
  }

  private async creditWin(args: {
    session: GameSessionWithGame
    providerId: string
    cb: ParsedProviderCallback
    winAmount: string
    tx?: WalletTx
  }): Promise<CreditResult> {
    const { session, providerId, cb, winAmount, tx } = args
    return this.wallet.credit({
      userId: session.userId,
      currency: session.currency as Currency,
      amount: winAmount,
      type: 'WIN',
      idempotencyKey: `win_${providerId}_${cb.transactionId}`,
      description: `Выигрыш в ${session.game.name}`,
      metadata: { provider_id: providerId },
      tx,
    })
  }

  private async getWalletBalance(userId: string, currency: string): Promise<string> {
    const bal = await this.wallet.getBalance(userId, currency as Currency)
    return bal.balance
  }
}
