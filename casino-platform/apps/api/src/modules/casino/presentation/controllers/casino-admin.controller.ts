import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { RolesGuard, Roles } from '../../../auth/presentation/guards/roles.guard'
import { prisma } from '@casino/database'

@UseGuards(AuthGuard, RolesGuard)
@Roles('admin','superadmin')
@Controller('admin')
export class CasinoAdminController {
  // providers
  @Get('providers')
  async providersList() {
    return prisma.gameProvider.findMany({ orderBy: { sortOrder: 'asc' }})
  }
  @Post('providers/:id/enable')
  async providerEnable(@Param('id') id: string) {
    await prisma.gameProvider.update({ where: { id }, data: { isEnabled: true }})
    return { ok: true }
  }
  @Post('providers/:id/disable')
  async providerDisable(@Param('id') id: string) {
    await prisma.gameProvider.update({ where: { id }, data: { isEnabled: false }})
    return { ok: true }
  }
  @Post('providers/:id/sync-games')
  async syncGames(@Param('id') id: string) {
    const provider = await prisma.gameProvider.findUnique({ where: { id }})
    if (!provider) throw new Error('NOT_FOUND')
    // DemoProvider sync – in real: call ProviderAdapterFactory.fetchGameList()
    const existingCount = await prisma.game.count({ where: { providerId: id }})
    return { added: 0, updated: existingCount, total: existingCount, note: 'Sync via ProviderAdapter – see tz-part-4 UC-GAME-19' }
  }

  // games
  @Get('games')
  async games(@Query() q: any) {
    const page = parseInt(q.page)||1, perPage = Math.min(parseInt(q.per_page)||50, 200)
    const where:any = {}
    if (q.provider_id) where.providerId = q.provider_id
    if (q.is_enabled !== undefined) where.isEnabled = q.is_enabled === 'true'
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' }}, { nameRu: { contains: q.search, mode: 'insensitive' }}]
    const [items, total] = await Promise.all([
      prisma.game.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{ sortOrder:'asc' }, include:{ provider:{ select:{ slug:true, name:true }}} }),
      prisma.game.count({ where })
    ])
    return { items, meta:{ page, perPage, total }}
  }
  @Patch('games/:id')
  async updateGame(@Param('id') id: string, @Body() b: any) {
    const data:any = {}
    if (b.name_ru !== undefined) data.nameRu = b.name_ru
    if (b.is_new !== undefined) data.isNew = b.is_new
    if (b.is_popular !== undefined) data.isPopular = b.isPopular ?? b.is_popular
    if (b.sort_order !== undefined) data.sortOrder = b.sort_order
    if (b.tags !== undefined) data.tags = b.tags
    await prisma.game.update({ where: { id }, data })
    return { ok: true }
  }
  @Post('games/:id/enable')
  async gameEnable(@Param('id') id: string) { await prisma.game.update({ where:{id}, data:{ isEnabled:true }}); return {ok:true}}
  @Post('games/:id/disable')
  async gameDisable(@Param('id') id: string) { await prisma.game.update({ where:{id}, data:{ isEnabled:false }}); return {ok:true}}
  @Post('games/:id/feature')
  async gameFeature(@Param('id') id: string) { await prisma.game.update({ where:{id}, data:{ isFeatured:true }}); return {ok:true}}
  @Post('games/:id/unfeature')
  async gameUnfeature(@Param('id') id: string) { await prisma.game.update({ where:{id}, data:{ isFeatured:false }}); return {ok:true}}

  // game sessions
  @Get('game-sessions')
  async sessions(@Query() q:any){
    const page=parseInt(q.page)||1, perPage=Math.min(parseInt(q.per_page)||50,200)
    const where:any = {}
    if(q.user_id) where.userId = q.user_id
    if(q.game_id) where.gameId = q.game_id
    if(q.provider_id) where.providerId = q.provider_id
    if(q.status) where.status = q.status
    const [items,total] = await Promise.all([
      prisma.gameSession.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{startedAt:'desc'}, include:{ user:{ select:{ email:true }}, game:{ select:{ name:true, slug:true }}, provider:{ select:{ name:true }}}}),
      prisma.gameSession.count({ where })
    ])
    return { items, meta:{ page, perPage, total }}
  }
  @Get('game-sessions/:id')
  async sessionDetail(@Param('id') id: string) {
    const session = await prisma.gameSession.findUnique({ where:{id}, include:{ game:true, user:{ select:{ email:true }}, gameRounds:{ include:{ gameTransactions:true }}}})
    return session
  }
  @Get('game-transactions')
  async gameTx(@Query() q:any){
    const page=parseInt(q.page)||1, perPage=Math.min(parseInt(q.per_page)||50,200)
    const where:any = {}
    if(q.user_id) where.userId = q.user_id
    if(q.provider_id) where.providerId = q.provider_id
    if(q.type) where.type = q.type
    const [items,total] = await Promise.all([
      prisma.gameTransaction.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{createdAt:'desc'}}),
      prisma.gameTransaction.count({ where })
    ])
    return { items, meta:{ page, perPage, total }}
  }
}
