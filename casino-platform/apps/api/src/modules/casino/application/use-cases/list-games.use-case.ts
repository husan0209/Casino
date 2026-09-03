import { Inject, Injectable } from '@nestjs/common'
import { GameType, GameCategory, GameVolatility } from '@casino/database'

import { GAME_CATALOG_REPOSITORY, type IGameCatalogRepository } from '../../domain/repositories/casino.repository'

import { type Prisma } from '@casino/database'


interface CatalogQuery {
  page?: string
  per_page?: string
  category?: string
  type?: string
  provider?: string
  is_featured?: string
  is_new?: string
  is_popular?: string
  search?: string
  sort?: string
}

@Injectable()
export class ListGamesUseCase {
  constructor(
    @Inject(GAME_CATALOG_REPOSITORY) private readonly catalog: IGameCatalogRepository,
  ) {}

  async execute(q: CatalogQuery): Promise<{ items: { id: string; name: string; type: GameType; provider: { name: string; slug: string; }; category: GameCategory; slug: string; nameRu: string | null; thumbnailUrl: string | null; isFeatured: boolean; isNew: boolean; isPopular: boolean; hasDemo: boolean; rtp: Prisma.Decimal | null; volatility: GameVolatility | null; }[]; meta: { page: number; perPage: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean; }; }> {
    const page = parseInt(q.page ?? '') || 1
    const perPage = Math.min(parseInt(q.per_page ?? '') || 24, 100)
    const where = this.buildWhere(q)
    const [items, total] = await Promise.all([
      this.catalog.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: this.buildOrderBy(q.sort),
        select: {
          id: true,
          slug: true,
          name: true,
          nameRu: true,
          category: true,
          type: true,
          thumbnailUrl: true,
          isFeatured: true,
          isNew: true,
          isPopular: true,
          hasDemo: true,
          rtp: true,
          volatility: true,
          provider: { select: { slug: true, name: true } },
        },
      }),
      this.catalog.count(where),
    ])
    return {
      items,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        hasNext: page * perPage < total,
        hasPrev: page > 1,
      },
    }
  }

  private buildWhere(q: CatalogQuery): Prisma.GameWhereInput {
    const where: Prisma.GameWhereInput = { isEnabled: true, provider: { isEnabled: true } }
    if (q.category) {
      where.category = q.category as never
    }
    if (q.type) {
      where.type = q.type as never
    }
    if (q.provider) {
      const provider: Prisma.GameProviderWhereInput = { ...where.provider, slug: q.provider }
      where.provider = provider
    }
    if (q.is_featured === 'true') {
      where.isFeatured = true
    }
    if (q.is_new === 'true') {
      where.isNew = true
    }
    if (q.is_popular === 'true') {
      where.isPopular = true
    }
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { nameRu: { contains: q.search, mode: 'insensitive' } },
      ]
    }
    return where
  }

  private buildOrderBy(sort?: string): Prisma.GameOrderByWithRelationInput {
    switch (sort) {
      case 'popular':
        return { launchCount: 'desc' }
      case 'new':
        return { createdAt: 'desc' }
      case 'name_asc':
        return { name: 'asc' }
      case 'name_desc':
        return { name: 'desc' }
      default:
        return { sortOrder: 'asc' }
    }
  }
}
