import { createHash } from 'crypto'

import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common'

import { prisma } from '@casino/database'

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { RolesGuard, Roles } from '../../../auth/presentation/guards/roles.guard'
import { ProviderAdapterFactory } from '../../infrastructure/providers/provider-adapter.factory'
import { UpdateGameSchema } from '../dto/admin-game.dto'

@UseGuards(AuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
@Controller('admin')
export class CasinoAdminController {
  constructor(private adapters: ProviderAdapterFactory) {}

  // providers
  @Get('providers')
  async providersList() {
    return prisma.gameProvider.findMany({ orderBy: { sortOrder: 'asc' } })
  }
  @Post('providers/:id/enable')
  async providerEnable(@Param('id') id: string) {
    await prisma.gameProvider.update({ where: { id }, data: { isEnabled: true } })
    return { ok: true }
  }
  @Post('providers/:id/disable')
  async providerDisable(@Param('id') id: string) {
    await prisma.gameProvider.update({ where: { id }, data: { isEnabled: false } })
    return { ok: true }
  }
  // UC-GAME-19: синхронизация каталога через ProviderAdapter
  @Post('providers/:id/sync-games')
  async syncGames(@Param('id') id: string) {
    const provider = await prisma.gameProvider.findUnique({ where: { id } })
    if (!provider) {
      throw new Error('NOT_FOUND')
    }
    const adapter = this.adapters.getAdapter(provider.slug)
    const list = await adapter.fetchGameList()

    let added = 0
    let updated = 0
    for (const g of list) {
      const slugBase =
        String(g.name || g.externalGameId)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'game'
      const slug = `${slugBase}-${createHash('md5').update(`${provider.slug}:${g.externalGameId}`).digest('hex').slice(0, 6)}`
      const data: any = {
        name: g.name || g.externalGameId,
        type: (g.type as any) ?? 'slot',
        category: (g.category as any) ?? 'slots',
        thumbnailUrl: g.thumbnailUrl ?? null,
        hasDemo: g.hasDemo ?? false,
        rtp: g.rtp != null ? String(g.rtp) : null, // eslint-disable-line eqeqeq -- null|undefined guard on provider payload
        metadata: (g.metadata ?? {}) as any,
      }
      const existing = await prisma.game.findUnique({
        where: { providerId_externalGameId: { providerId: id, externalGameId: g.externalGameId } },
      })
      if (existing) {
        await prisma.game.update({ where: { id: existing.id }, data })
        updated++
      } else {
        // UC-GAME-19 правило: новые игры добавляются ВЫКЛЮЧЕННЫМИ
        await prisma.game.create({
          data: {
            ...data,
            providerId: id,
            externalGameId: g.externalGameId,
            slug,
            isEnabled: false,
          },
        })
        added++
      }
    }

    const total = await prisma.game.count({ where: { providerId: id } })
    await prisma.gameProvider.update({ where: { id }, data: { gameCount: total } })
    return {
      added,
      updated,
      total,
      note: 'Новые игры добавлены выключенными — включите нужные в разделе «Игры»',
    }
  }

  // games
  @Get('games')
  async games(@Query() q: any) {
    const page = parseInt(q.page) || 1,
      perPage = Math.min(parseInt(q.per_page) || 50, 200)
    const where: any = {}
    if (q.provider_id) {
      where.providerId = q.provider_id
    }
    if (q.is_enabled !== undefined) {
      where.isEnabled = q.is_enabled === 'true'
    }
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { nameRu: { contains: q.search, mode: 'insensitive' } },
      ]
    }
    const [items, total] = await Promise.all([
      prisma.game.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { sortOrder: 'asc' },
        include: { provider: { select: { slug: true, name: true } } },
      }),
      prisma.game.count({ where }),
    ])
    return { items, meta: { page, perPage, total } }
  }
  @Patch('games/:id')
  @UsePipes(new ZodValidationPipe(UpdateGameSchema))
  async updateGame(
    @Param('id') id: string,
    @Body()
    b: {
      name_ru?: string
      is_new?: boolean
      is_popular?: boolean
      isPopular?: boolean
      sort_order?: number
      tags?: string[]
    },
  ) {
    const data: any = {}
    if (b.name_ru !== undefined) {
      data.nameRu = b.name_ru
    }
    if (b.is_new !== undefined) {
      data.isNew = b.is_new
    }
    if (b.is_popular !== undefined) {
      data.isPopular = b.isPopular ?? b.is_popular
    }
    if (b.sort_order !== undefined) {
      data.sortOrder = b.sort_order
    }
    if (b.tags !== undefined) {
      data.tags = b.tags
    }
    await prisma.game.update({ where: { id }, data })
    return { ok: true }
  }
  @Post('games/:id/enable')
  async gameEnable(@Param('id') id: string) {
    await prisma.game.update({ where: { id }, data: { isEnabled: true } })
    return { ok: true }
  }
  @Post('games/:id/disable')
  async gameDisable(@Param('id') id: string) {
    await prisma.game.update({ where: { id }, data: { isEnabled: false } })
    return { ok: true }
  }
  @Post('games/:id/feature')
  async gameFeature(@Param('id') id: string) {
    await prisma.game.update({ where: { id }, data: { isFeatured: true } })
    return { ok: true }
  }
  @Post('games/:id/unfeature')
  async gameUnfeature(@Param('id') id: string) {
    await prisma.game.update({ where: { id }, data: { isFeatured: false } })
    return { ok: true }
  }

  // game sessions
  @Get('game-sessions')
  async sessions(@Query() q: any) {
    const page = parseInt(q.page) || 1,
      perPage = Math.min(parseInt(q.per_page) || 50, 200)
    const where: any = {}
    if (q.user_id) {
      where.userId = q.user_id
    }
    if (q.game_id) {
      where.gameId = q.game_id
    }
    if (q.provider_id) {
      where.providerId = q.provider_id
    }
    if (q.status) {
      where.status = q.status
    }
    const [items, total] = await Promise.all([
      prisma.gameSession.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { startedAt: 'desc' },
        include: {
          user: { select: { email: true } },
          game: { select: { name: true, slug: true } },
          provider: { select: { name: true } },
        },
      }),
      prisma.gameSession.count({ where }),
    ])
    return { items, meta: { page, perPage, total } }
  }
  @Get('game-sessions/:id')
  async sessionDetail(@Param('id') id: string) {
    const session = await prisma.gameSession.findUnique({
      where: { id },
      include: {
        game: true,
        user: { select: { email: true } },
        gameRounds: { include: { gameTransactions: true } },
      },
    })
    return session
  }
  @Get('game-transactions')
  async gameTx(@Query() q: any) {
    const page = parseInt(q.page) || 1,
      perPage = Math.min(parseInt(q.per_page) || 50, 200)
    const where: any = {}
    if (q.user_id) {
      where.userId = q.user_id
    }
    if (q.provider_id) {
      where.providerId = q.provider_id
    }
    if (q.type) {
      where.type = q.type
    }
    const [items, total] = await Promise.all([
      prisma.gameTransaction.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.gameTransaction.count({ where }),
    ])
    return { items, meta: { page, perPage, total } }
  }
}
