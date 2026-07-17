import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
@Injectable()
export class FavoritesUseCase {
  async add(userId: string, slug: string) {
    const game = await prisma.game.findUnique({ where: { slug }})
    if (!game) throw new Error('GAME_NOT_FOUND')
    await prisma.gameFavorite.upsert({
      where: { userId_gameId: { userId, gameId: game.id }},
      update: {},
      create: { userId, gameId: game.id }
    })
    return { ok: true }
  }
  async remove(userId: string, slug: string) {
    const game = await prisma.game.findUnique({ where: { slug }})
    if (game) await prisma.gameFavorite.deleteMany({ where: { userId, gameId: game.id }})
    return { ok: true }
  }
  async list(userId: string, page=1, perPage=24) {
    const [rows, total] = await Promise.all([
      prisma.gameFavorite.findMany({
        where: { userId, game: { isEnabled: true }},
        skip: (page-1)*perPage, take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { game: { include: { provider: { select: { slug:true, name:true }}}}}
      }),
      prisma.gameFavorite.count({ where: { userId }})
    ])
    return { items: rows.map(r=>r.game), total }
  }
  async recent(userId: string) {
    const sessions = await prisma.gameSession.findMany({
      where: { userId, isDemo: false },
      orderBy: { lastActivityAt: 'desc' },
      distinct: ['gameId'],
      take: 20,
      include: { game: { include: { provider: true }}}
    })
    return sessions.map(s => s.game)
  }
  async history(userId: string, page=1, perPage=20, gameId?: string) {
    const where:any = { userId }
    if (gameId) where.gameId = gameId
    const [rounds, total] = await Promise.all([
      prisma.gameRound.findMany({
        where, skip:(page-1)*perPage, take:perPage, orderBy:{createdAt:'desc'},
        include: { game: { select: { slug:true, name:true, provider: { select:{ name:true }}}}}
      }),
      prisma.gameRound.count({ where })
    ])
    const data = rounds.map(r => ({
      round_id: r.id,
      game: { slug: r.game.slug, name: r.game.name, provider: r.game.provider.name },
      currency: r.currency,
      total_bet: r.totalBet.toString(),
      total_win: r.totalWin.toString(),
      profit: (Number(r.totalWin) - Number(r.totalBet)).toFixed(2),
      status: r.status,
      created_at: r.createdAt,
    }))
    return { data, total }
  }
}
