import { createHash } from 'crypto'

import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common'


import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'
import { RolesGuard, Roles } from '@modules/auth/presentation/guards/roles.guard'

import {
  prisma,
  type GameCategory,
  type GameSessionStatus,
  type GameTransactionType,
  type GameType,
  type Prisma,
} from '@casino/database'

import { type ProviderGameRow } from '../../domain/provider-adapter.interface'
import { ProviderAdapterFactory } from '../../infrastructure/providers/provider-adapter.factory'
import { UpdateGameSchema } from '../dto/admin-game.dto'

/** Стабильный slug игры: читаемая база + хэш пары (provider, externalId). */
function gameSlug(providerSlug: string, externalGameId: string, name?: string): string {
  const slugBase =
    String(name || externalGameId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'game'
  const hash = createHash('md5')
    .update(`${providerSlug}:${externalGameId}`)
    .digest('hex')
    .slice(0, 6)
  return `${slugBase}-${hash}`
}

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
      if (await this.upsertGameRow(id, provider.slug, g)) {
        updated++
      } else {
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

  /**
   * Одна строка каталога: update существующей игры либо create новой.
   * @returns true если игра уже была (обновили), false — добавили.
   */
  private async upsertGameRow(
    providerId: string,
    providerSlug: string,
    g: ProviderGameRow,
  ): Promise<boolean> {
    const data = {
      name: g.name || g.externalGameId,
      type: (g.type as GameType) ?? 'slot',
      category: (g.category as GameCategory) ?? 'slots',
      thumbnailUrl: g.thumbnailUrl ?? null,
      hasDemo: g.hasDemo ?? false,
      rtp: g.rtp != null ? String(g.rtp) : null, // eslint-disable-line eqeqeq -- null|undefined guard on provider payload
      metadata: (g.metadata ?? {}) as Prisma.InputJsonValue,
    }
    const existing = await prisma.game.findUnique({
      where: { providerId_externalGameId: { providerId, externalGameId: g.externalGameId } },
    })
    if (existing) {
      await prisma.game.update({ where: { id: existing.id }, data })
      return true
    }
    // UC-GAME-19 правило: новые игры добавляются ВЫКЛЮЧЕННЫМИ
    await prisma.game.create({
      data: {
        ...data,
        providerId,
        externalGameId: g.externalGameId,
        slug: gameSlug(providerSlug, g.externalGameId, g.name),
        isEnabled: false,
      },
    })
    return false
  }

  // games
  @Get('games')
  async games(@Query() q: Record<string, string | undefined>) {
    const page = parseInt(q.page ?? '') || 1,
      perPage = Math.min(parseInt(q.per_page ?? '') || 50, 200)
    const where: Prisma.GameWhereInput = {}
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
    const data: Prisma.GameUpdateInput = {}
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
  async sessions(@Query() q: Record<string, string | undefined>) {
    const page = parseInt(q.page ?? '') || 1,
      perPage = Math.min(parseInt(q.per_page ?? '') || 50, 200)
    const where: Prisma.GameSessionWhereInput = {}
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
      where.status = q.status as GameSessionStatus
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
  async gameTx(@Query() q: Record<string, string | undefined>) {
    const page = parseInt(q.page ?? '') || 1,
      perPage = Math.min(parseInt(q.per_page ?? '') || 50, 200)
    const where: Prisma.GameTransactionWhereInput = {}
    if (q.user_id) {
      where.userId = q.user_id
    }
    if (q.provider_id) {
      where.providerId = q.provider_id
    }
    if (q.type) {
      where.type = q.type as GameTransactionType
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
