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

/** Избранное и история игрока. */
export interface IGameFavoritesRepository {
  upsert(userId: string, gameId: string): Promise<void>
  remove(userId: string, gameId: string): Promise<void>
  findWithGame<I extends Prisma.GameFavoriteInclude>(query: {
    where: Prisma.GameFavoriteWhereInput
    skip: number
    take: number
    orderBy: Prisma.GameFavoriteOrderByWithRelationInput
    include: I
  }): Promise<Prisma.GameFavoriteGetPayload<{ include: I }>[]>
  count(where: Prisma.GameFavoriteWhereInput): Promise<number>
  /** Последние уникальные игры игрока (distinct по gameId, только реальные сессии). */
  findRecentSessions(userId: string, take: number): Promise<RecentSessionRow[]>
  findRounds<I extends Prisma.GameRoundInclude>(query: {
    where: Prisma.GameRoundWhereInput
    skip: number
    take: number
    orderBy: Prisma.GameRoundOrderByWithRelationInput
    include: I
  }): Promise<Prisma.GameRoundGetPayload<{ include: I }>[]>
  countRounds(where: Prisma.GameRoundWhereInput): Promise<number>
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
  addSessionBet(id: string, amount: string): Promise<void>
  addSessionWin(id: string, amount: string): Promise<void>
  findRoundByExternal(providerId: string, externalRoundId: string): Promise<GameRow | null>
  createRound(data: Prisma.GameRoundUncheckedCreateInput): Promise<GameRow>
  updateRound(id: string, data: Prisma.GameRoundUncheckedUpdateInput): Promise<void>
  findTransactionByExternal(
    providerId: string,
    externalTransactionId: string,
  ): Promise<GameTransactionRow | null>
  findRollbackOf(roundId: string, rollbackOfId: string): Promise<GameTransactionRow | null>
  createTransaction(data: Prisma.GameTransactionUncheckedCreateInput): Promise<GameTransactionRow>
}

export const GAME_PLAY_REPOSITORY = Symbol('GAME_PLAY_REPOSITORY')
