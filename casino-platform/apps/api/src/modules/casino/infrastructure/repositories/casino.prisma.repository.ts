import { Injectable } from '@nestjs/common'

import { prisma, type GameSession, type Prisma } from '@casino/database'

import {
  IGameCatalogRepository,
  IGameFavoritesRepository,
  IGamePlayRepository,
  type GameWithProvider,
  type GameSessionWithUser,
  type GameSessionWithGame,
  type GameRow,
  type GameTransactionRow,
  type RecentSessionRow,
  type FavoriteWithGame,
  type RoundHistoryRow,
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

  findFavorites(userId: string, skip: number, take: number): Promise<FavoriteWithGame[]> {
    return prisma.gameFavorite.findMany({
      where: { userId, game: { isEnabled: true } },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: { game: { include: { provider: { select: { slug: true, name: true } } } } },
    })
  }

  countFavorites(userId: string): Promise<number> {
    return prisma.gameFavorite.count({ where: { userId } })
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

  findRoundsWithGame(args: {
    userId: string
    gameId: string | undefined
    skip: number
    take: number
  }): Promise<RoundHistoryRow[]> {
    const { userId, gameId, skip, take } = args
    return prisma.gameRound.findMany({
      where: { userId, ...(gameId ? { gameId } : {}) },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        game: { select: { slug: true, name: true, provider: { select: { name: true } } } },
      },
    })
  }

  countRounds(userId: string, gameId?: string): Promise<number> {
    return prisma.gameRound.count({ where: { userId, ...(gameId ? { gameId } : {}) } })
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

  findSessionByToken(token: string): Promise<GameSession | null> {
    return prisma.gameSession.findUnique({ where: { sessionToken: token } })
  }

  async closeActiveSessions(userId: string, providerId: string): Promise<void> {
    await prisma.gameSession.updateMany({
      where: { userId, providerId, status: 'active' },
      data: { status: 'closed', closedAt: new Date() },
    })
  }

  createSession(
    data: Prisma.GameSessionUncheckedCreateInput,
  ): Promise<{ id: string; sessionToken: string }> {
    return prisma.gameSession.create({
      data,
      select: { id: true, sessionToken: true },
    })
  }

  async touchSession(id: string): Promise<void> {
    await prisma.gameSession.update({ where: { id }, data: { lastActivityAt: new Date() } })
  }

  async addSessionBet(
    id: string,
    amount: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? prisma
    await client.gameSession.update({
      where: { id },
      data: {
        totalBet: { increment: amount },
        roundsPlayed: { increment: 1 },
        lastActivityAt: new Date(),
      },
    })
  }

  async addSessionWin(
    id: string,
    amount: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? prisma
    await client.gameSession.update({
      where: { id },
      data: { totalWin: { increment: amount }, lastActivityAt: new Date() },
    })
  }

  findRoundByExternal(
    providerId: string,
    externalRoundId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GameRow | null> {
    return (tx ?? prisma).gameRound.findUnique({
      where: { providerId_externalRoundId: { providerId, externalRoundId } },
    })
  }

  createRound(
    data: Prisma.GameRoundUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<GameRow> {
    return (tx ?? prisma).gameRound.create({ data })
  }

  async updateRound(
    id: string,
    data: Prisma.GameRoundUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await (tx ?? prisma).gameRound.update({ where: { id }, data })
  }

  findTransactionByExternal(
    providerId: string,
    externalTransactionId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GameTransactionRow | null> {
    return (tx ?? prisma).gameTransaction.findUnique({
      where: { providerId_externalTransactionId: { providerId, externalTransactionId } },
    })
  }

  findRollbackOf(
    roundId: string,
    rollbackOfId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GameTransactionRow | null> {
    return (tx ?? prisma).gameTransaction.findFirst({
      where: {
        roundId,
        type: 'rollback',
        metadata: { path: ['rollback_of'], equals: rollbackOfId },
      },
    })
  }

  createTransaction(
    data: Prisma.GameTransactionUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<GameTransactionRow> {
    return (tx ?? prisma).gameTransaction.create({ data })
  }
}
