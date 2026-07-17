import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ListGamesUseCase } from '../../application/use-cases/list-games.use-case'
import { LaunchGameUseCase } from '../../application/use-cases/launch-game.use-case'
import { FavoritesUseCase } from '../../application/use-cases/favorites.use-case'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { prisma } from '@casino/database'

@Controller('casino')
export class CasinoController {
  constructor(private listGames: ListGamesUseCase, private launchGame: LaunchGameUseCase, private fav: FavoritesUseCase) {}
  @Get('games')
  games(@Query() q: any) { return this.listGames.execute(q).then(r => ({ data: r.items, meta: r.meta })) }
  @Get('games/:slug')
  async game(@Param('slug') slug: string) {
    const g = await prisma.game.findUnique({ where: { slug }, include: { provider: { select: { slug:true, name:true }}}})
    return g
  }
  @Get('providers')
  async providers() {
    const rows = await prisma.gameProvider.findMany({ where: { isEnabled: true }, orderBy: { sortOrder: 'asc' }})
    return rows.map(p => ({ slug: p.slug, name: p.name, logo_url: p.logoUrl, game_count: p.gameCount, type: p.type }))
  }
  @Get('categories')
  async categories() {
    const cats = [
      {slug:'slots', name:'Слоты'},
      {slug:'live_casino', name:'Live Казино'},
      {slug:'table_games', name:'Настольные игры'},
      {slug:'instant_games', name:'Быстрые игры'},
    ]
    const res = await Promise.all(cats.map(async c => ({ ...c, game_count: await prisma.game.count({ where: { category: c.slug as any, isEnabled: true }})})))
    return res
  }
  @Post('games/:slug/launch')
  @UseGuards(AuthGuard)
  async launch(@Param('slug') slug: string, @Body() body: any, @Req() req: any) {
    const isMobile = /mobile/i.test(req.headers['user-agent'] || '')
    return this.launchGame.execute({
      userId: req.user.id, gameSlug: slug,
      currency: body.currency || 'RUB',
      returnUrl: body.return_url || 'http://localhost:3000',
      isDemo: false, isMobile, ip: req.ip,
    })
  }
  @Post('games/:slug/demo')
  async demo(@Param('slug') slug: string, @Body() body: any, @Req() req: any) {
    const isMobile = /mobile/i.test(req.headers['user-agent'] || '')
    return this.launchGame.execute({
      userId: null, gameSlug: slug,
      currency: body.currency || 'RUB',
      returnUrl: body.return_url || 'http://localhost:3000',
      isDemo: true, isMobile, ip: req.ip,
    })
  }
  @Post('games/:slug/favorite')
  @UseGuards(AuthGuard)
  async favAdd(@CurrentUser() u: any, @Param('slug') slug: string) { await this.fav.add(u.id, slug); return { ok: true } }
  @Delete('games/:slug/favorite')
  @UseGuards(AuthGuard)
  async favDel(@CurrentUser() u: any, @Param('slug') slug: string) { await this.fav.remove(u.id, slug); return { ok: true } }
  @Get('favorites')
  @UseGuards(AuthGuard)
  async favList(@CurrentUser() u:any, @Query() q:any) {
    const page = parseInt(q.page)||1, perPage = parseInt(q.per_page)||24
    const r = await this.fav.list(u.id, page, perPage)
    return { data: r.items, meta: { page, perPage, total: r.total, totalPages: Math.ceil(r.total/perPage), hasNext: page*perPage < r.total, hasPrev: page>1 }}
  }
  @Get('recent')
  @UseGuards(AuthGuard)
  async recent(@CurrentUser() u:any) { return { data: await this.fav.recent(u.id) } }
  @Get('history')
  @UseGuards(AuthGuard)
  async history(@CurrentUser() u:any, @Query() q:any) {
    const page = parseInt(q.page)||1, perPage = parseInt(q.per_page)||20
    const r = await this.fav.history(u.id, page, perPage, q.game_id)
    return { data: r.data, meta: { page, per_page: perPage, total: r.total, total_pages: Math.ceil(r.total/perPage)}}
  }
}
