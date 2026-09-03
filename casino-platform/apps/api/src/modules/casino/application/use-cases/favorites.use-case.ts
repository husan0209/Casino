import { Inject, Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import {
  GAME_CATALOG_REPOSITORY,
  GAME_FAVORITES_REPOSITORY,
  type FavoriteWithGame,
  IGameCatalogRepository,
  IGameFavoritesRepository,
} from '../../domain/repositories/casino.repository'

export interface GameHistoryRow {
  round_id: string
  game: { slug: string; name: string; provider: string }
  currency: string
  total_bet: string
  total_win: string
  profit: string
  status: string
  created_at: Date
}

@Injectable()
export class FavoritesUseCase {
  constructor(
    @Inject(GAME_CATALOG_REPOSITORY) private readonly catalog: IGameCatalogRepository,
    @Inject(GAME_FAVORITES_REPOSITORY) private readonly favorites: IGameFavoritesRepository,
  ) {}

  async add(userId: string, slug: string): Promise<{ ok: boolean }> {
    const game = await this.catalog.findBySlug(slug)
    if (!game) {
      throw new Error('GAME_NOT_FOUND')
    }
    await this.favorites.upsert(userId, game.id)
    return { ok: true }
  }

  async remove(userId: string, slug: string): Promise<{ ok: boolean }> {
    const game = await this.catalog.findBySlug(slug)
    if (game) {
      await this.favorites.remove(userId, game.id)
    }
    return { ok: true }
  }

  async list(
    userId: string,
    page = 1,
    perPage = 24,
  ): Promise<{ items: FavoriteWithGame['game'][]; total: number }> {
    const [rows, total] = await Promise.all([
      this.favorites.findFavorites(userId, (page - 1) * perPage, perPage),
      this.favorites.countFavorites(userId),
    ])
    return { items: rows.map((r) => r.game), total }
  }

  async recent(userId: string): Promise<FavoriteWithGame['game'][]> {
    const sessions = await this.favorites.findRecentSessions(userId, 20)
    return sessions.map((s) => s.game)
  }

  async history(args: {
    userId: string
    page: number
    perPage: number
    gameId?: string
  }): Promise<{ data: GameHistoryRow[]; total: number }> {
    const { userId, page, perPage, gameId } = args
    const [rounds, total] = await Promise.all([
      this.favorites.findRoundsWithGame({ userId, gameId, skip: (page - 1) * perPage, take: perPage }),
      this.favorites.countRounds(userId, gameId),
    ])
    const data = rounds.map((r) => ({
      round_id: r.id,
      game: { slug: r.game.slug, name: r.game.name, provider: r.game.provider.name },
      currency: r.currency,
      total_bet: r.totalBet.toString(),
      total_win: r.totalWin.toString(),
      profit: new Decimal(r.totalWin).minus(r.totalBet).toFixed(2),
      status: r.status,
      created_at: r.createdAt,
    }))
    return { data, total }
  }
}
