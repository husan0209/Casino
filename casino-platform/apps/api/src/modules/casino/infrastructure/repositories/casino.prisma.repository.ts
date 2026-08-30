import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'
import type { Prisma } from '@prisma/client'

import {
  type IGameCatalogRepository,
  type IGameFavoritesRepository,
  type IGamePlayRepository,
  type GameWithProvider,
  type GameSessionWithUser,
  type GameSessionWithGame,
  type GameRow,
  type GameTransactionRow,
  type RecentSessionRow,
  type GameCatalogQuery,
} from '../../domain/repositories/casino.repository'

@Injectable()
export class PrismaGameCatalogRepository implements IGameCatalogRepository {
  findBySlug(slug: string): Promise<GameWithProvider | null> {
    return prisma.game.findUnique({ where: { slug }, include: { provider: true } })
  }

  findMany<S extends Prisma.GameSelect>(
    query: GameCatalogQuery & { select: S },
  ): Promise<Prisma.GameGetPayload<{ select: S }>[]> {
    return prisma.game.findMany({
      where: query.where,
      skip: query.skip,
      take: query.take,
      orderBy: query.orderBy,
      select: query.select,
    })
  }

  count(where: Prisma.GameWhereInput): Promise<number> {
    return prisma.game.count({ where })
  }

  async incrementLaunchCount(id: string): Promise<void> {
    await prisma.game.update({ where: { id }, data: { launchCount: { increment: 1 } } })
  }
}

@Injectable()
export class PrismaGameFavoritesRepository implements IGameFavoritesRepository {
  async upsert(userId: string, gameId: string): Promise<void> {
    await prisma.gameFavorite.upsert({
      where: { userId_gameId: { userId, gameId } },
      update: {},
      create: { userId, gameId },
    })
  }

  async remove(userId: string, gameId: string): Promise<void> {
    await prisma.gameFavorite.deleteMany({ where: { userId, gameId } })
  }

  findWithGame<I extends Prisma.GameFavoriteInclude>(query: {
    where: Prisma.GameFavoriteWhereInput
    skip: number
    take: number
    orderBy: Prisma.GameFavoriteOrderByWithRelationInput
    include: I
  }): Promise<Prisma.GameFavoriteGetPayload<{ include: I }>[]> {
    return prisma.gameFavorite.findMany({
      where: query.where,
      skip: query.skip,
      take: query.take,
      orderBy: query.orderBy,
      include: query.include,
    })
  }

  count(where: Prisma.GameFavoriteWhereInput): Promise<number> {
    return prisma.gameFavorite.count({ where })
  }

  findRecentSessions(userId: string, take: number): Promise<RecentSessionRow[]> {
    return prisma.gameSession.findMany({
      where: { userId, isDemo: false },
      orderBy: { lastActivityAt: 'desc' },
      distinct: ['gameId'],
      take,
      include: { game: { include: { provider: true } } },
    })
  }

  findRounds<I extends Prisma.GameRoundInclude>(query: {
    where: Prisma.GameRoundWhereInput
    skip: number
    take: number
    orderBy: Prisma.GameRoundOrderByWithRelationInput
    include: I
  }): Promise<Prisma.GameRoundGetPayload<{ include: I }>[]> {
    return prisma.gameRound.findMany({
      where: query.where,
      skip: query.skip,
      take: query.take,
      orderBy: query.orderBy,
      include: query.include,
    })
  }

  countRounds(where: Prisma.GameRoundWhereInput): Promise<number> {
    return prisma.gameRound.count({ where })
  }
}

@Injectable()
export class PrismaGamePlayRepository implements IGamePlayRepository {
  findSessionByTokenWithUser(token: string): Promise<GameSessionWithUser | null> {
    return prisma.gameSession.findUnique({ where: { sessionToken: token }, include: { user: true } })
  }

  findSessionByTokenWithGame(token: string): Promise<GameSessionWithGame | null> {
    return prisma.gameSession.findUnique({ where: { sessionToken: token }, include: { game: true } })
  }

  findSessionByToken(token: string) {
    return prisma.gameSession.findUnique({ where: { sessionToken: token } })
  }

  async closeActiveSessions(userId: string, providerId: string): Promise<void> {
    await prisma.gameSession.updateMany({
      where: { userId, providerId, status: 'active' },
      data: { status: 'closed', closedAt: new Date() },
    })
  }

  createSession(data: Prisma.GameSessionUncheckedCreateInput) {
    return prisma.gameSession.create({
      data,
      select: { id: true, sessionToken: true },
    })
  }

  async touchSession(id: string): Promise<void> {
    await prisma.gameSession.update({ where: { id }, data: { lastActivityAt: new Date() } })
  }

  async addSessionBet(id: string, amount: string): Promise<void> {
    await prisma.gameSession.update({
      where: { id },
      data: {
        totalBet: { increment: amount },
        roundsPlayed: { increment: 1 },
        lastActivityAt: new Date(),
      },
    })
  }

  async addSessionWin(id: string, amount: string): Promise<void> {
    await prisma.gameSession.update({
      where: { id },
      data: { totalWin: { increment: amount }, lastActivityAt: new Date() },
    })
  }

  findRoundByExternal(providerId: string, externalRoundId: string): Promise<GameRow | null> {
    return prisma.gameRound.findUnique({
      where: { providerId_externalRoundId: { providerId, externalRoundId } },
    })
  }

  createRound(data: Prisma.GameRoundUncheckedCreateInput): Promise<GameRow> {
    return prisma.gameRound.create({ data })
  }

  async updateRound(id: string, data: Prisma.GameRoundUncheckedUpdateInput): Promise<void> {
    await prisma.gameRound.update({ where: { id }, data })
  }

  findTransactionByExternal(
    providerId: string,
    externalTransactionId: string,
  ): Promise<GameTransactionRow | null> {
    return prisma.gameTransaction.findUnique({
      where: { providerId_externalTransactionId: { providerId, externalTransactionId } },
    })
  }

  findRollbackOf(roundId: string, rollbackOfId: string): Promise<GameTransactionRow | null> {
    return prisma.gameTransaction.findFirst({
      where: {
        roundId,
        type: 'rollback',
        metadata: { path: ['rollback_of'], equals: rollbackOfId },
      },
    })
  }

  createTransaction(data: Prisma.GameTransactionUncheckedCreateInput): Promise<GameTransactionRow> {
    return prisma.gameTransaction.create({ data })
  }
}
