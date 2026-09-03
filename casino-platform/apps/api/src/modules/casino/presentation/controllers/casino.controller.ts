import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards, UsePipes } from '@nestjs/common'
import { type Request } from 'express'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type UserActor } from '@/common/types/req-user'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'
import { type FavoritesUseCase, type GameHistoryRow } from '@modules/casino/application/use-cases/favorites.use-case'

import { type GameCategory, type GameType, type GameVolatility, prisma, type Prisma } from '@casino/database'

import { type LaunchGameUseCase } from '../../application/use-cases/launch-game.use-case'
import { type ListGamesUseCase } from '../../application/use-cases/list-games.use-case'
import { LaunchGameSchema } from '../dto/launch.dto'

@Controller('casino')
export class CasinoController {
  constructor(
    private readonly listGamesUseCase: ListGamesUseCase,
    private readonly launchGameUseCase: LaunchGameUseCase,
    private readonly favoritesUseCase: FavoritesUseCase,
  ) {}

  @Get('games')
  async games(@Query() queryParams: Record<string, string | undefined>): Promise<{ data: { id: string; name: string; type: GameType; provider: { name: string; slug: string; }; category: GameCategory; slug: string; nameRu: string | null; thumbnailUrl: string | null; isFeatured: boolean; isNew: boolean; isPopular: boolean; hasDemo: boolean; rtp: Prisma.Decimal | null; volatility: GameVolatility | null; }[]; meta: { page: number; perPage: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean; }; }> {
    const result = await this.listGamesUseCase.execute(queryParams)
    return {
      data: result.items,
      meta: result.meta,
    }
  }

  @Get('games/:slug')
  async game(@Param('slug') slug: string): Promise<({ provider: { name: string; slug: string; }; } & { id: string; createdAt: Date; updatedAt: Date; name: string; type: GameType; metadata: Prisma.JsonValue; category: GameCategory; providerId: string; externalGameId: string; slug: string; nameRu: string | null; subcategory: string | null; thumbnailUrl: string | null; bannerUrl: string | null; isEnabled: boolean; isFeatured: boolean; isNew: boolean; isPopular: boolean; hasDemo: boolean; rtp: Prisma.Decimal | null; volatility: GameVolatility | null; maxWinMultiplier: Prisma.Decimal | null; minBet: Prisma.Decimal | null; maxBet: Prisma.Decimal | null; supportedCurrencies: Prisma.JsonValue; tags: Prisma.JsonValue; sortOrder: number; launchCount: number; }) | null> {
    const gameRecord = await prisma.game.findUnique({
      where: { slug },
      include: {
        provider: {
          select: { slug: true, name: true },
        },
      },
    })
    return gameRecord
  }

  @Get('providers')
  async providers(): Promise<{ slug: string; name: string; logo_url: string | null; game_count: number; type: string; }[]> {
    const rows = await prisma.gameProvider.findMany({
      where: { isEnabled: true },
      orderBy: { sortOrder: 'asc' },
    })
    return rows.map(
      (provider: { slug: string; name: string; logoUrl: string | null; gameCount: number; type: string }) => ({
        slug: provider.slug,
        name: provider.name,
        logo_url: provider.logoUrl,
        game_count: provider.gameCount,
        type: provider.type,
      }),
    )
  }

  @Get('categories')
  async categories(): Promise<{ game_count: number; slug: string; name: string; }[]> {
    const categoryList = [
      { slug: 'slots', name: 'Слоты' },
      { slug: 'live_casino', name: 'Live Казино' },
      { slug: 'table_games', name: 'Настольные игры' },
      { slug: 'instant_games', name: 'Быстрые игры' },
    ]
    const result = await Promise.all(
      categoryList.map(async (category) => ({
        ...category,
        game_count: await prisma.game.count({
          where: { category: category.slug as GameCategory, isEnabled: true },
        }),
      })),
    )
    return result
  }

  @Post('games/:slug/launch')
  @UseGuards(AuthGuard)
  @UsePipes(new ZodValidationPipe(LaunchGameSchema))
  async launch(
    @Param('slug') slug: string,
    @Body() dto: { currency?: string; return_url?: string },
    @Req() req: Request,
  ): Promise<{ session_id: string | null; launch_url: string; currency: string; }> {
    const isMobile = /mobile/i.test(req.headers['user-agent'] || '')
    return this.launchGameUseCase.execute({
      userId: (req.user as UserActor).id,
      gameSlug: slug,
      currency: dto.currency || 'RUB',
      returnUrl: dto.return_url || 'http://localhost:3000',
      isDemo: false,
      isMobile,
      ip: req.ip ?? '',
    })
  }

  @Post('games/:slug/demo')
  @UsePipes(new ZodValidationPipe(LaunchGameSchema))
  async demo(
    @Param('slug') slug: string,
    @Body() dto: { currency?: string; return_url?: string },
    @Req() req: Request,
  ): Promise<{ session_id: string | null; launch_url: string; currency: string; }> {
    const isMobile = /mobile/i.test(req.headers['user-agent'] || '')
    return this.launchGameUseCase.execute({
      userId: null,
      gameSlug: slug,
      currency: dto.currency || 'RUB',
      returnUrl: dto.return_url || 'http://localhost:3000',
      isDemo: true,
      isMobile,
      ip: req.ip ?? '',
    })
  }

  @Post('games/:slug/favorite')
  @UseGuards(AuthGuard)
  async favAdd(@CurrentUser() currentUser: { id: string }, @Param('slug') slug: string): Promise<{ ok: boolean; }> {
    await this.favoritesUseCase.add(currentUser.id, slug)
    return { ok: true }
  }

  @Delete('games/:slug/favorite')
  @UseGuards(AuthGuard)
  async favDel(@CurrentUser() currentUser: { id: string }, @Param('slug') slug: string): Promise<{ ok: boolean; }> {
    await this.favoritesUseCase.remove(currentUser.id, slug)
    return { ok: true }
  }

  @Get('favorites')
  @UseGuards(AuthGuard)
  async favList(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: { page?: string; per_page?: string },
  ): Promise<{ data: ({ id: string; createdAt: Date; updatedAt: Date; name: string; type: GameType; metadata: Prisma.JsonValue; category: GameCategory; providerId: string; externalGameId: string; slug: string; nameRu: string | null; subcategory: string | null; thumbnailUrl: string | null; bannerUrl: string | null; isEnabled: boolean; isFeatured: boolean; isNew: boolean; isPopular: boolean; hasDemo: boolean; rtp: Prisma.Decimal | null; volatility: GameVolatility | null; maxWinMultiplier: Prisma.Decimal | null; minBet: Prisma.Decimal | null; maxBet: Prisma.Decimal | null; supportedCurrencies: Prisma.JsonValue; tags: Prisma.JsonValue; sortOrder: number; launchCount: number; } & { provider: { slug: string; name: string; }; })[]; meta: { page: number; perPage: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean; }; }> {
    const page = parseInt(queryParams.page ?? '1', 10) || 1
    const perPage = parseInt(queryParams.per_page || '24', 10) || 24
    const result = await this.favoritesUseCase.list(currentUser.id, page, perPage)
    return {
      data: result.items,
      meta: {
        page,
        perPage,
        total: result.total,
        totalPages: Math.ceil(result.total / perPage),
        hasNext: page * perPage < result.total,
        hasPrev: page > 1,
      },
    }
  }

  @Get('recent')
  @UseGuards(AuthGuard)
  async recent(@CurrentUser() currentUser: { id: string }): Promise<{ data: ({ id: string; createdAt: Date; updatedAt: Date; name: string; type: GameType; metadata: Prisma.JsonValue; category: GameCategory; providerId: string; externalGameId: string; slug: string; nameRu: string | null; subcategory: string | null; thumbnailUrl: string | null; bannerUrl: string | null; isEnabled: boolean; isFeatured: boolean; isNew: boolean; isPopular: boolean; hasDemo: boolean; rtp: Prisma.Decimal | null; volatility: GameVolatility | null; maxWinMultiplier: Prisma.Decimal | null; minBet: Prisma.Decimal | null; maxBet: Prisma.Decimal | null; supportedCurrencies: Prisma.JsonValue; tags: Prisma.JsonValue; sortOrder: number; launchCount: number; } & { provider: { slug: string; name: string; }; })[]; }> {
    const data = await this.favoritesUseCase.recent(currentUser.id)
    return { data }
  }

  @Get('history')
  @UseGuards(AuthGuard)
  async history(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: { page?: string; per_page?: string; game_id?: string },
  ): Promise<{ data: GameHistoryRow[]; meta: { page: number; per_page: number; total: number; total_pages: number; }; }> {
    const page = parseInt(queryParams.page ?? '1', 10) || 1
    const perPage = parseInt(queryParams.per_page || '20', 10) || 20
    const result = await this.favoritesUseCase.history({
      userId: currentUser.id,
      page,
      perPage,
      ...(queryParams.game_id ? { gameId: queryParams.game_id } : {}),
    })
    return {
      data: result.data,
      meta: {
        page,
        per_page: perPage,
        total: result.total,
        total_pages: Math.ceil(result.total / perPage),
      },
    }
  }
}
