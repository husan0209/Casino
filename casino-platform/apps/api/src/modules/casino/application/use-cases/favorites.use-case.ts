import { Inject, Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import {
  GAME_CATALOG_REPOSITORY,
  GAME_FAVORITES_REPOSITORY,
  type FavoriteWithGame,
  type IGameCatalogRepository,
  type IGameFavoritesRepository,
  type RoundHistoryFilter,
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

/** Итоги по одной валюте (деньги — строки, не number). */
export interface GameHistoryStatsRow {
  currency: string
  rounds: number
  turnover: string
  wins: string
}

/** Фильтр §12 (игра/провайдер/валюта/период) без пагинации — общий для аргументов use-case. */
export interface HistoryFilterArgs {
  userId: string
  gameId?: string | undefined
  providerSlug?: string | undefined
  currency?: string | undefined
  from?: Date | undefined
  to?: Date | undefined
}

export interface HistoryArgs extends HistoryFilterArgs {
  page: number
  perPage: number
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

  async history(args: HistoryArgs): Promise<{
    data: GameHistoryRow[]
    total: number
    stats: GameHistoryStatsRow[]
  }> {
    const filter: RoundHistoryFilter = {
      userId: args.userId,
      ...(args.gameId !== undefined && { gameId: args.gameId }),
      ...(args.providerSlug !== undefined && { providerSlug: args.providerSlug }),
      ...(args.currency !== undefined && { currency: args.currency }),
      ...(args.from !== undefined && { from: args.from }),
      ...(args.to !== undefined && { to: args.to }),
    }
    const [rounds, total, grouped] = await Promise.all([
      this.favorites.findRoundsWithGame({
        ...filter,
        skip: (args.page - 1) * args.perPage,
        take: args.perPage,
      }),
      this.favorites.countRounds(filter),
      this.favorites.roundStats(filter),
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
    const stats = grouped.map((row) => ({
      currency: row.currency,
      rounds: row.rounds,
      turnover: row.turnover?.toString() ?? '0',
      wins: row.wins?.toString() ?? '0',
    }))
    return { data, total, stats }
  }
}
