/**
 * Репозитории casino-домена. Application/слои знают только эти интерфейсы;
 * Prisma-реализации живут в infrastructure/repositories (audit §A3, A4, H5).
 *
 * Типы Prisma импортируются ТОЛЬКО как type-only из '@prisma/client' —
 * они стираются при компиляции и не создают рантайм-зависимости на БД-клиент
 * (гард G1 запрещает только '@casino/database' — рантайм-импорт).
 */
import type {
  Prisma,
  Game,
  GameProvider,
  GameSession,
  GameRound,
  GameTransaction,
  User,
} from '@prisma/client'
import type { Decimal } from 'decimal.js'

export type GameWithProvider = Game & { provider: GameProvider }
export type GameSessionWithUser = GameSession & { user: User }
export type GameSessionWithGame = GameSession & { game: Game }
export type GameRow = GameRound
export type GameTransactionRow = GameTransaction
export type RecentSessionRow = GameSession & { game: GameWithProvider }

export interface GameCatalogQuery {
  where: Prisma.GameWhereInput
  skip: number
  take: number
  orderBy: Prisma.GameOrderByWithRelationInput
}

/** Каталог игр: листинг, поиск по slug, счётчик запусков. */
export interface IGameCatalogRepository {
  findBySlug(slug: string): Promise<GameWithProvider | null>
  findMany<S extends Prisma.GameSelect>(
    query: GameCatalogQuery & { select: S },
  ): Promise<Prisma.GameGetPayload<{ select: S }>[]>
  count(where: Prisma.GameWhereInput): Promise<number>
  incrementLaunchCount(id: string): Promise<void>
}

export const GAME_CATALOG_REPOSITORY = Symbol('GAME_CATALOG_REPOSITORY')

export interface FavoriteWithGame {
  id: string
  createdAt: Date
  game: Game & { provider: { slug: string; name: string } }
}

export interface RoundHistoryRow {
  id: string
  currency: string
  totalBet: Decimal
  totalWin: Decimal
  status: string
  createdAt: Date
  game: { slug: string; name: string; provider: { name: string } }
}

/** Избранное и история игрока. */
export interface IGameFavoritesRepository {
  upsert(userId: string, gameId: string): Promise<void>
  remove(userId: string, gameId: string): Promise<void>
  findFavorites(userId: string, skip: number, take: number): Promise<FavoriteWithGame[]>
  countFavorites(userId: string): Promise<number>
  /** Последние уникальные игры игрока (distinct по gameId, только реальные сессии). */
  findRecentSessions(userId: string, take: number): Promise<RecentSessionRow[]>
  findRoundsWithGame(args: {
    userId: string
    gameId: string | undefined
    skip: number
    take: number
  }): Promise<RoundHistoryRow[]>
  countRounds(userId: string, gameId?: string): Promise<number>
}

export const GAME_FAVORITES_REPOSITORY = Symbol('GAME_FAVORITES_REPOSITORY')

/** Игровые сессии/раунды/транзакции: коллбэки провайдеров и запуск игр. */
export interface IGamePlayRepository {
  findSessionByTokenWithUser(token: string): Promise<GameSessionWithUser | null>
  findSessionByTokenWithGame(token: string): Promise<GameSessionWithGame | null>
  findSessionByToken(token: string): Promise<GameSession | null>
  closeActiveSessions(userId: string, providerId: string): Promise<void>
  createSession(
    data: Prisma.GameSessionUncheckedCreateInput,
  ): Promise<{ id: string; sessionToken: string }>
  touchSession(id: string): Promise<void>
  addSessionBet(id: string, amount: string, tx?: Prisma.TransactionClient): Promise<void>
  addSessionWin(id: string, amount: string, tx?: Prisma.TransactionClient): Promise<void>
  findRoundByExternal(
    providerId: string,
    externalRoundId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GameRow | null>
  createRound(data: Prisma.GameRoundUncheckedCreateInput, tx?: Prisma.TransactionClient): Promise<GameRow>
  updateRound(
    id: string,
    data: Prisma.GameRoundUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void>
  findTransactionByExternal(
    providerId: string,
    externalTransactionId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GameTransactionRow | null>
  findRollbackOf(
    roundId: string,
    rollbackOfId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GameTransactionRow | null>
  createTransaction(
    data: Prisma.GameTransactionUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<GameTransactionRow>
}

export const GAME_PLAY_REPOSITORY = Symbol('GAME_PLAY_REPOSITORY')
