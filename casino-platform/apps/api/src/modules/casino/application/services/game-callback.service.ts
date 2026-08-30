import { Inject, Injectable } from '@nestjs/common'

import { money } from '@casino/shared-utils'

import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { type ParsedProviderCallback } from '../../domain/provider-adapter.interface'
import {
  GAME_PLAY_REPOSITORY,
  type GameRow,
  type GameSessionWithGame,
  type GameSessionWithUser,
  type GameTransactionRow,
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
    const round = await this.findOrCreateRound(providerId, cb, session, 'open')
    const creditRes = await this.wallet.debit({
      userId: session.userId,
      currency: session.currency as any,
      amount: cb.betAmount,
      type: 'BET',
      idempotencyKey: `bet_${providerId}_${cb.transactionId}`,
      description: `Ставка в ${session.game.name}`,
      metadata: {
        provider_id: providerId,
        game_id: session.gameId,
        round_id: round.id,
        external_transaction_id: cb.transactionId,
      },
    })
    await this.play.createTransaction({
      roundId: round.id,
      sessionId: session.id,
      userId: session.userId,
      providerId,
      type: 'bet',
      externalTransactionId: cb.transactionId!,
      amount: cb.betAmount,
      currency: session.currency,
      balanceAfter: creditRes.balanceAfter,
      ledgerEntryId: creditRes.ledgerEntryId,
      metadata: cb.rawRequest ?? {},
    })
    await this.play.updateRound(round.id, { totalBet: { increment: cb.betAmount } })
    await this.play.addSessionBet(session.id, cb.betAmount)
    return { balance: creditRes.balanceAfter, duplicate: false }
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
    const round = await this.findOrCreateRound(providerId, cb, session, 'closed')
    let balanceAfter = '0'
    let ledgerEntryId: string | null = null
    if (money.isPositive(winAmount)) {
      const res = await this.creditWin(session, providerId, cb, winAmount)
      balanceAfter = res.balanceAfter
      ledgerEntryId = res.ledgerEntryId
    } else {
      balanceAfter = await this.getWalletBalance(session.userId, session.currency)
    }
    await this.play.createTransaction({
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
    })
    if (money.isPositive(winAmount)) {
      await this.play.updateRound(round.id, {
        totalWin: { increment: winAmount },
        status: 'closed',
        closedAt: new Date(),
      })
      await this.play.addSessionWin(session.id, winAmount)
    }
    return { balance: balanceAfter, duplicate: false }
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
    const res = await this.wallet.credit({
      userId: session.userId,
      currency: session.currency as any,
      amount: rollbackAmount,
      type: 'ROLLBACK',
      idempotencyKey: `rollback_${providerId}_${cb.transactionId || originalTx.id}`,
      description: 'Отмена ставки',
      metadata: { rollback_of: originalTx.id },
    })
    await this.play.createTransaction({
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
    })
    await this.play.updateRound(originalTx.roundId, {
      totalBet: { decrement: rollbackAmount },
      status: 'rolled_back',
    })
    return { balance: res.balanceAfter }
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
  ): Promise<GameRow> {
    const roundExternalId = cb.roundId || cb.transactionId!
    const existing = await this.play.findRoundByExternal(providerId, roundExternalId)
    if (existing) {
      return existing
    }
    return this.play.createRound({
      sessionId: session.id,
      userId: session.userId,
      gameId: session.gameId,
      providerId,
      externalRoundId: roundExternalId,
      currency: session.currency,
      status: initialStatus,
      ...(initialStatus === 'closed' ? { closedAt: new Date() } : {}),
    })
  }

  private async creditWin(
    session: GameSessionWithGame,
    providerId: string,
    cb: ParsedProviderCallback,
    winAmount: string,
  ) {
    return this.wallet.credit({
      userId: session.userId,
      currency: session.currency as any,
      amount: winAmount,
      type: 'WIN',
      idempotencyKey: `win_${providerId}_${cb.transactionId}`,
      description: `Выигрыш в ${session.game.name}`,
      metadata: { provider_id: providerId },
    })
  }

  private async getWalletBalance(userId: string, currency: string): Promise<string> {
    const bal = await this.wallet.getBalance(userId, currency as any)
    return bal.balance
  }
}
