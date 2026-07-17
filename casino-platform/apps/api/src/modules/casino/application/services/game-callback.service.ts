import { Injectable, Logger } from '@nestjs/common'
import { prisma } from '@casino/database'
import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { ParsedProviderCallback } from '../../domain/provider-adapter.interface'

@Injectable()
export class GameCallbackService {
  private logger = new Logger(GameCallbackService.name)
  constructor(private wallet: WalletFacade) {}

  async authenticate(sessionToken: string) {
    const session = await prisma.gameSession.findUnique({
      where: { sessionToken },
      include: { user: true, game: true }
    })
    if (!session || session.status !== 'active') throw new Error('SESSION_INVALID')
    if (session.user.status !== 'active') throw new Error('PLAYER_BLOCKED')
    await prisma.gameSession.update({ where: { id: session.id }, data: { lastActivityAt: new Date() }})
    const wallet = await prisma.walletAccount.findUnique({ where: { userId_currency: { userId: session.userId, currency: session.currency }}})
    const balance = wallet?.balance?.toString() ?? '0'
    return { player_id: session.userId, currency: session.currency, balance, nickname: session.user.email || session.user.id.slice(0,8) }
  }

  async balance(sessionToken: string) {
    const a = await this.authenticate(sessionToken)
    return { balance: a.balance, currency: a.currency }
  }

  async bet(cb: ParsedProviderCallback, providerId: string) {
    if (!cb.playerToken || !cb.transactionId || !cb.betAmount) throw new Error('INVALID_BET_REQUEST')
    const session = await prisma.gameSession.findUnique({ where: { sessionToken: cb.playerToken }, include: { game: true }})
    if (!session || session.status !== 'active') throw new Error('SESSION_INVALID')
    // idempotency
    const dup = await prisma.gameTransaction.findUnique({ where: { providerId_externalTransactionId: { providerId, externalTransactionId: cb.transactionId }}})
    if (dup) {
      const w = await prisma.walletAccount.findUnique({ where: { userId_currency: { userId: session.userId, currency: session.currency }}})
      return { balance: w?.balance?.toString() ?? '0', duplicate: true }
    }
    // round
    const roundExternalId = cb.roundId || cb.transactionId
    let round = await prisma.gameRound.findUnique({ where: { providerId_externalRoundId: { providerId, externalRoundId: roundExternalId }}})
    if (!round) {
      round = await prisma.gameRound.create({ data: {
        sessionId: session.id, userId: session.userId, gameId: session.gameId,
        providerId, externalRoundId: roundExternalId, currency: session.currency, status: 'open'
      }})
    }
    // debit wallet
    const creditRes = await this.wallet.debit({
      userId: session.userId,
      currency: session.currency as any,
      amount: cb.betAmount,
      type: 'BET',
      idempotencyKey: `bet_${providerId}_${cb.transactionId}`,
      description: `Ставка в ${session.game.name}`,
      metadata: { provider_id: providerId, game_id: session.gameId, round_id: round.id, external_transaction_id: cb.transactionId }
    })
    // game_transaction
    await prisma.gameTransaction.create({
      data: {
        roundId: round.id, sessionId: session.id, userId: session.userId, providerId,
        type: 'bet',
        externalTransactionId: cb.transactionId!,
        amount: cb.betAmount,
        currency: session.currency,
        balanceAfter: creditRes.balanceAfter,
        ledgerEntryId: creditRes.ledgerEntryId,
        metadata: cb.rawRequest ?? {}
      }
    })
    await prisma.gameRound.update({ where: { id: round.id }, data: { totalBet: { increment: cb.betAmount }}})
    await prisma.gameSession.update({ where: { id: session.id }, data: { totalBet: { increment: cb.betAmount }, roundsPlayed: { increment: 1 }, lastActivityAt: new Date() }})
    return { balance: creditRes.balanceAfter, duplicate: false }
  }

  async win(cb: ParsedProviderCallback, providerId: string) {
    if (!cb.playerToken || !cb.transactionId) throw new Error('INVALID_WIN_REQUEST')
    const session = await prisma.gameSession.findUnique({ where: { sessionToken: cb.playerToken }, include: { game: true }})
    if (!session) throw new Error('SESSION_INVALID')
    const dup = await prisma.gameTransaction.findUnique({ where: { providerId_externalTransactionId: { providerId, externalTransactionId: cb.transactionId }}})
    if (dup) {
      const w = await prisma.walletAccount.findUnique({ where: { userId_currency: { userId: session.userId, currency: session.currency }}})
      return { balance: w?.balance?.toString() ?? '0', duplicate: true }
    }
    const winAmount = cb.winAmount || '0'
    const roundExternalId = cb.roundId || cb.transactionId
    let round = await prisma.gameRound.findUnique({ where: { providerId_externalRoundId: { providerId, externalRoundId: roundExternalId }}})
    if (!round) {
      round = await prisma.gameRound.create({ data: {
        sessionId: session.id, userId: session.userId, gameId: session.gameId,
        providerId, externalRoundId: roundExternalId, currency: session.currency, status: 'closed', closedAt: new Date()
      }})
    }
    let balanceAfter = '0'
    let ledgerEntryId: string | null = null
    if (parseFloat(winAmount) > 0) {
      const res = await this.wallet.credit({
        userId: session.userId, currency: session.currency as any, amount: winAmount,
        type: 'WIN',
        idempotencyKey: `win_${providerId}_${cb.transactionId}`,
        description: `Выигрыш в ${session.game.name}`,
        metadata: { provider_id: providerId }
      })
      balanceAfter = res.balanceAfter
      ledgerEntryId = res.ledgerEntryId
    } else {
      const w = await prisma.walletAccount.findUnique({ where: { userId_currency: { userId: session.userId, currency: session.currency }}})
      balanceAfter = w?.balance?.toString() ?? '0'
    }
    await prisma.gameTransaction.create({
      data: {
        roundId: round.id, sessionId: session.id, userId: session.userId, providerId,
        type: 'win',
        externalTransactionId: cb.transactionId!,
        amount: winAmount,
        currency: session.currency,
        balanceAfter,
        ledgerEntryId,
        metadata: cb.rawRequest ?? {}
      }
    })
    if (parseFloat(winAmount) > 0) {
      await prisma.gameRound.update({ where: { id: round.id }, data: { totalWin: { increment: winAmount }, status: 'closed', closedAt: new Date() }})
      await prisma.gameSession.update({ where: { id: session.id }, data: { totalWin: { increment: winAmount }, lastActivityAt: new Date() }})
    }
    return { balance: balanceAfter, duplicate: false }
  }

  async rollback(cb: ParsedProviderCallback, providerId: string) {
    if (!cb.playerToken || !cb.rollbackTransactionId) throw new Error('INVALID_ROLLBACK_REQUEST')
    const session = await prisma.gameSession.findUnique({ where: { sessionToken: cb.playerToken }})
    if (!session) throw new Error('SESSION_INVALID')
    const originalTx = await prisma.gameTransaction.findUnique({
      where: { providerId_externalTransactionId: { providerId, externalTransactionId: cb.rollbackTransactionId }}
    })
    if (!originalTx) {
      // phantom rollback – return current balance
      const w = await prisma.walletAccount.findUnique({ where: { userId_currency: { userId: session.userId, currency: session.currency }}})
      return { balance: w?.balance?.toString() ?? '0', phantom: true }
    }
    // check already rolled back
    const already = await prisma.gameTransaction.findFirst({
      where: { roundId: originalTx.roundId, type: 'rollback', metadata: { path: ['rollback_of'], equals: originalTx.id }}
    })
    if (already) {
      const w = await prisma.walletAccount.findUnique({ where: { userId_currency: { userId: session.userId, currency: session.currency }}})
      return { balance: w?.balance?.toString() ?? '0', duplicate: true }
    }
    const rollbackAmount = originalTx.amount.toString()
    const res = await this.wallet.credit({
      userId: session.userId,
      currency: session.currency as any,
      amount: rollbackAmount,
      type: 'ROLLBACK',
      idempotencyKey: `rollback_${providerId}_${cb.transactionId || originalTx.id}`,
      description: 'Отмена ставки',
      metadata: { rollback_of: originalTx.id }
    })
    await prisma.gameTransaction.create({
      data: {
        roundId: originalTx.roundId, sessionId: session.id, userId: session.userId, providerId,
        type: 'rollback',
        externalTransactionId: cb.transactionId || `rb_${originalTx.externalTransactionId}`,
        amount: rollbackAmount,
        currency: session.currency,
        balanceAfter: res.balanceAfter,
        ledgerEntryId: res.ledgerEntryId,
        metadata: { ...(cb.rawRequest ?? {}), rollback_of: originalTx.id }
      }
    })
    await prisma.gameRound.update({ where: { id: originalTx.roundId }, data: { totalBet: { decrement: rollbackAmount }, status: 'rolled_back' }})
    return { balance: res.balanceAfter }
  }
}
