import { Inject, Injectable } from '@nestjs/common'
import Decimal from 'decimal.js'

import { GAME_CATALOG_REPOSITORY, GAME_FAVORITES_REPOSITORY } from '../../domain/repositories/casino.repository'
import type { IGameCatalogRepository, IGameFavoritesRepository } from '../../domain/repositories/casino.repository'

@Injectable()
export class FavoritesUseCase {
  constructor(
    @Inject(GAME_CATALOG_REPOSITORY) private readonly catalog: IGameCatalogRepository,
    @Inject(GAME_FAVORITES_REPOSITORY) private readonly favorites: IGameFavoritesRepository,
  ) {}

  async add(userId: string, slug: string) {
    const game = await this.catalog.findBySlug(slug)
    if (!game) {
      throw new Error('GAME_NOT_FOUND')
    }
    await this.favorites.upsert(userId, game.id)
    return { ok: true }
  }

  async remove(userId: string, slug: string) {
    const game = await this.catalog.findBySlug(slug)
    if (game) {
      await this.favorites.remove(userId, game.id)
    }
    return { ok: true }
  }

  async list(userId: string, page = 1, perPage = 24) {
    const [rows, total] = await Promise.all([
      this.favorites.findWithGame({
        where: { userId, game: { isEnabled: true } },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { game: { include: { provider: { select: { slug: true, name: true } } } } },
      }),
      this.favorites.count({ where: { userId } }),
    ])
    return { items: rows.map((r) => r.game), total }
  }

  async recent(userId: string) {
    const sessions = await this.favorites.findRecentSessions(userId, 20)
    return sessions.map((s) => s.game)
  }

  async history(userId: string, page = 1, perPage = 20, gameId?: string) {
    const where: { userId: string; gameId?: string } = { userId }
    if (gameId) {
      where.gameId = gameId
    }
    const [rounds, total] = await Promise.all([
      this.favorites.findRounds({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          game: { select: { slug: true, name: true, provider: { select: { name: true } } } },
        },
      }),
      this.favorites.countRounds(where),
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
