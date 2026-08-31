import { Inject, Injectable } from '@nestjs/common'

import { type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { type ParsedProviderCallback } from '../../domain/provider-adapter.interface'
import {
  GAME_PLAY_REPOSITORY,
  type GameRow,
  type GameSessionWithGame,
  type IGamePlayRepository,
} from '../../domain/repositories/casino.repository'

@Injectable()
export class GameCallbackService {
  constructor(
    private wallet: WalletFacade,
    @Inject(GAME_PLAY_REPOSITORY) private readonly play: IGamePlayRepository,
  ) {}

  async authenticate(sessionToken: string) {
    const session = await this.play.findSessionByTokenWithUser(sessionToken)
    if (!session || session.status !== 'active') {
      throw new Error('SESSION_INVALID')
    }
    if (session.user.status !== 'active') {
      throw new Error('PLAYER_BLOCKED')
    }
    await this.play.touchSession(session.id)
    const balance = await this.getWalletBalance(session.userId, session.currency)
    return {
      player_id: session.userId,
      currency: session.currency,
      balance,
      nickname: session.user.email || session.user.id.slice(0, 8),
    }
  }

  async balance(sessionToken: string) {
    const a = await this.authenticate(sessionToken)
    return { balance: a.balance, currency: a.currency }
  }

  async bet(cb: ParsedProviderCallback, providerId: string) {
    if (!cb.playerToken || !cb.transactionId || !cb.betAmount) {
      throw new Error('INVALID_BET_REQUEST')
    }
    const session = await this.findActiveSession(cb.playerToken)
    const dup = await this.play.findTransactionByExternal(providerId, cb.transactionId)
    if (dup) {
      return { balance: await this.getWalletBalance(session.userId, session.currency), duplicate: true }
    }
    // сужаем типы до замыкания (внутри колбэка narrowing не работает)
    const externalId = cb.transactionId!
    const betAmount = cb.betAmount!
    // P0 #3: ledger-запись и gameTransaction в одной $transaction — краш между
    // операциями больше не оставляет деньги без записи (или наоборот).
    return this.wallet.runInTransaction(async (tx) => {
      // повторная проверка дубликата внутри транзакции (гонка двух одновременных bet)
      const dupInTx = await this.play.findTransactionByExternal(providerId, externalId, tx)
      if (dupInTx) {
        return { balance: await this.getWalletBalance(session.userId, session.currency), duplicate: true }
      }
      const round = await this.findOrCreateRound(providerId, cb, session, 'open', tx)
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
      await this.play.createTransaction(
        {
          roundId: round.id,
          sessionId: session.id,
          userId: session.userId,
          providerId,
          type: 'bet',
          externalTransactionId: externalId,
          amount: betAmount,
          currency: session.currency,
          balanceAfter: creditRes.balanceAfter,
          ledgerEntryId: creditRes.ledgerEntryId,
          metadata: cb.rawRequest ?? {},
        },
        tx,
      )
      await this.play.updateRound(round.id, { totalBet: { increment: betAmount } }, tx)
      await this.play.addSessionBet(session.id, betAmount, tx)
      return { balance: creditRes.balanceAfter, duplicate: false }
    })
  }

  async win(cb: ParsedProviderCallback, providerId: string) {
    if (!cb.playerToken || !cb.transactionId) {
      throw new Error('INVALID_WIN_REQUEST')
    }
    const session = await this.play.findSessionByTokenWithGame(cb.playerToken)
    if (!session) {
      throw new Error('SESSION_INVALID')
    }
    const dup = await this.play.findTransactionByExternal(providerId, cb.transactionId)
    if (dup) {
      return { balance: await this.getWalletBalance(session.userId, session.currency), duplicate: true }
    }
    const winAmount = cb.winAmount || '0'
    // P0 #3: атомарно — credit + gameTransaction + закрытие раунда.
    return this.wallet.runInTransaction(async (tx) => {
      const dupInTx = await this.play.findTransactionByExternal(providerId, cb.transactionId!, tx)
      if (dupInTx) {
        return { balance: await this.getWalletBalance(session.userId, session.currency), duplicate: true }
      }
      const round = await this.findOrCreateRound(providerId, cb, session, 'closed', tx)
      let balanceAfter = '0'
      let ledgerEntryId: string | null = null
      if (money.isPositive(winAmount)) {
        const res = await this.creditWin(session, providerId, cb, winAmount, tx)
        balanceAfter = res.balanceAfter
        ledgerEntryId = res.ledgerEntryId
      } else {
        balanceAfter = await this.getWalletBalance(session.userId, session.currency)
      }
      await this.play.createTransaction(
        {
          roundId: round.id,
          sessionId: session.id,
          userId: session.userId,
          providerId,
          type: 'win',
          externalTransactionId: cb.transactionId!,
          amount: winAmount,
          currency: session.currency,
          balanceAfter,
          ledgerEntryId,
          metadata: cb.rawRequest ?? {},
        },
        tx,
      )
      if (money.isPositive(winAmount)) {
        await this.play.updateRound(
          round.id,
          {
            totalWin: { increment: winAmount },
            status: 'closed',
            closedAt: new Date(),
          },
          tx,
        )
        await this.play.addSessionWin(session.id, winAmount, tx)
      }
      return { balance: balanceAfter, duplicate: false }
    })
  }

  async rollback(cb: ParsedProviderCallback, providerId: string) {
    if (!cb.playerToken || !cb.rollbackTransactionId) {
      throw new Error('INVALID_ROLLBACK_REQUEST')
    }
    const session = await this.play.findSessionByToken(cb.playerToken)
    if (!session) {
      throw new Error('SESSION_INVALID')
    }
    const originalTx = await this.play.findTransactionByExternal(
      providerId,
      cb.rollbackTransactionId,
    )
    if (!originalTx) {
      // phantom rollback – return current balance
      return { balance: await this.getWalletBalance(session.userId, session.currency), phantom: true }
    }
    const already = await this.play.findRollbackOf(originalTx.roundId, originalTx.id)
    if (already) {
      return { balance: await this.getWalletBalance(session.userId, session.currency), duplicate: true }
    }
    const rollbackAmount = originalTx.amount.toString()
    if (originalTx.type === 'rollback') {
      throw new Error('CANNOT_ROLLBACK_A_ROLLBACK')
    }
    // Reverse the ORIGINAL effect: a bet (debit) is refunded with a credit;
    // a win (credit) is taken back with a debit. Without this, rolling back a
    // win would pay the win amount a second time.
    const isBet = originalTx.type === 'bet'
    // P0 #3: атомарно — компенсирующая проводка + rollback-запись + раунд.
    return this.wallet.runInTransaction(async (tx) => {
      // гонка двух одновременных rollback — перепроверка внутри транзакции
      const alreadyInTx = await this.play.findRollbackOf(originalTx.roundId, originalTx.id, tx)
      if (alreadyInTx) {
        return { balance: await this.getWalletBalance(session.userId, session.currency), duplicate: true }
      }
      const res = isBet
        ? await this.wallet.credit({
            userId: session.userId,
            currency: session.currency as Currency,
            amount: rollbackAmount,
            type: 'ROLLBACK',
            idempotencyKey: `rollback_${providerId}_${cb.transactionId || originalTx.id}`,
            description: 'Отмена ставки',
            metadata: { rollback_of: originalTx.id },
            tx,
          })
        : await this.wallet.debit({
            userId: session.userId,
            currency: session.currency as Currency,
            amount: rollbackAmount,
            type: 'ROLLBACK',
            idempotencyKey: `rollback_${providerId}_${cb.transactionId || originalTx.id}`,
            description: 'Отмена выигрыша',
            metadata: { rollback_of: originalTx.id },
            tx,
          })
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
    })
  }

  /** Активная сессия с игрой — общий вход bet/win. */
  private async findActiveSession(token: string): Promise<GameSessionWithGame> {
    const session = await this.play.findSessionByTokenWithGame(token)
    if (!session || session.status !== 'active') {
      throw new Error('SESSION_INVALID')
    }
    return session
  }

  private async findOrCreateRound(
    providerId: string,
    cb: ParsedProviderCallback,
    session: GameSessionWithGame,
    initialStatus: 'open' | 'closed',
    tx?: Parameters<Parameters<WalletFacade['runInTransaction']>[0]>[0],
  ): Promise<GameRow> {
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

  private async creditWin(
    session: GameSessionWithGame,
    providerId: string,
    cb: ParsedProviderCallback,
    winAmount: string,
    tx?: Parameters<Parameters<WalletFacade['runInTransaction']>[0]>[0],
  ) {
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
