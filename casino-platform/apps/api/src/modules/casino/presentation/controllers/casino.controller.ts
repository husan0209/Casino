import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'

import { prisma } from '@casino/database'

import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { FavoritesUseCase } from '../../application/use-cases/favorites.use-case'
import { LaunchGameUseCase } from '../../application/use-cases/launch-game.use-case'
import { ListGamesUseCase } from '../../application/use-cases/list-games.use-case'

@Controller('casino')
export class CasinoController {
  constructor(
    private readonly listGamesUseCase: ListGamesUseCase,
    private readonly launchGameUseCase: LaunchGameUseCase,
    private readonly favoritesUseCase: FavoritesUseCase,
  ) {}

  @Get('games')
  async games(@Query() queryParams: any) {
    const result = await this.listGamesUseCase.execute(queryParams)
    return {
      data: result.items,
      meta: result.meta,
    }
  }

  @Get('games/:slug')
  async game(@Param('slug') slug: string) {
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
  async providers() {
    const rows = await prisma.gameProvider.findMany({
      where: { isEnabled: true },
      orderBy: { sortOrder: 'asc' },
    })
    return rows.map((provider: { slug: string; name: string; logoUrl: any; gameCount: number; type: any }) => ({
      slug: provider.slug,
      name: provider.name,
      logo_url: provider.logoUrl,
      game_count: provider.gameCount,
      type: provider.type,
    }))
  }

  @Get('categories')
  async categories() {
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
          where: { category: category.slug as any, isEnabled: true },
        }),
      })),
    )
    return result
  }

  @Post('games/:slug/launch')
  @UseGuards(AuthGuard)
  async launch(
    @Param('slug') slug: string,
    @Body() dto: { currency?: string; return_url?: string },
    @Req() req: any,
  ) {
    const isMobile = /mobile/i.test(req.headers['user-agent'] || '')
    return this.launchGameUseCase.execute({
      userId: req.user.id,
      gameSlug: slug,
      currency: dto.currency || 'RUB',
      returnUrl: dto.return_url || 'http://localhost:3000',
      isDemo: false,
      isMobile,
      ip: req.ip,
    })
  }

  @Post('games/:slug/demo')
  async demo(
    @Param('slug') slug: string,
    @Body() dto: { currency?: string; return_url?: string },
    @Req() req: any,
  ) {
    const isMobile = /mobile/i.test(req.headers['user-agent'] || '')
    return this.launchGameUseCase.execute({
      userId: null,
      gameSlug: slug,
      currency: dto.currency || 'RUB',
      returnUrl: dto.return_url || 'http://localhost:3000',
      isDemo: true,
      isMobile,
      ip: req.ip,
    })
  }

  @Post('games/:slug/favorite')
  @UseGuards(AuthGuard)
  async favAdd(
    @CurrentUser() currentUser: { id: string },
    @Param('slug') slug: string,
  ) {
    await this.favoritesUseCase.add(currentUser.id, slug)
    return { ok: true }
  }

  @Delete('games/:slug/favorite')
  @UseGuards(AuthGuard)
  async favDel(
    @CurrentUser() currentUser: { id: string },
    @Param('slug') slug: string,
  ) {
    await this.favoritesUseCase.remove(currentUser.id, slug)
    return { ok: true }
  }

  @Get('favorites')
  @UseGuards(AuthGuard)
  async favList(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: { page?: string; per_page?: string },
  ) {
    const page = parseInt(queryParams.page || '1', 10) || 1
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
  async recent(@CurrentUser() currentUser: { id: string }) {
    const data = await this.favoritesUseCase.recent(currentUser.id)
    return { data }
  }

  @Get('history')
  @UseGuards(AuthGuard)
  async history(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: { page?: string; per_page?: string; game_id?: string },
  ) {
    const page = parseInt(queryParams.page || '1', 10) || 1
    const perPage = parseInt(queryParams.per_page || '20', 10) || 20
    const result = await this.favoritesUseCase.history(
      currentUser.id,
      page,
      perPage,
      queryParams.game_id,
    )
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
