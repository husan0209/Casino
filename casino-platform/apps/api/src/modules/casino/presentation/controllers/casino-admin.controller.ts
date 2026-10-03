import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'
import { Roles, RolesGuard } from '@modules/auth/presentation/guards/roles.guard'

import {
  type GameCategory,
  type GameProviderType,
  type GameSessionStatus,
  type GameTransactionType,
  type GameType,
  type GameVolatility,
  prisma,
  type Prisma,
} from '@casino/database'

import { AdminSetGameFlagsUseCase } from '../../application/use-cases/admin-set-game-flags.use-case'
import { AdminSetProviderEnabledUseCase } from '../../application/use-cases/admin-set-provider-enabled.use-case'
import {
  AdminSyncProviderGamesUseCase,
  type ProviderGamesSyncResult,
} from '../../application/use-cases/admin-sync-provider-games.use-case'
import { AdminUpdateGameUseCase } from '../../application/use-cases/admin-update-game.use-case'
import { UpdateGameSchema } from '../dto/admin-game.dto'

/**
 * Строки ответов админ-каталога. Типы ВЫВОДЯТСЯ из схемы Prisma по той же
 * include-конфигурации, что и запросы: развёрнутые литералы молча расходились
 * с реальными колонками (например, забывали поле, добавленное миграцией) и
 * раздували методы до 98 строк.
 */
type AdminSessionDetail = Prisma.GameSessionGetPayload<{
  include: {
    game: true
    user: { select: { email: true } }
    gameRounds: { include: { gameTransactions: true } }
  }
}>

type AdminGamesPage = {
  items: ({ provider: { name: string; slug: string } } & {
    id: string
    createdAt: Date
    updatedAt: Date
    name: string
    type: GameType
    metadata: Prisma.JsonValue
    category: GameCategory
    providerId: string
    externalGameId: string
    slug: string
    nameRu: string | null
    subcategory: string | null
    thumbnailUrl: string | null
    bannerUrl: string | null
    isEnabled: boolean
    isFeatured: boolean
    isNew: boolean
    isPopular: boolean
    hasDemo: boolean
    rtp: Prisma.Decimal | null
    volatility: GameVolatility | null
    maxWinMultiplier: Prisma.Decimal | null
    minBet: Prisma.Decimal | null
    maxBet: Prisma.Decimal | null
    supportedCurrencies: Prisma.JsonValue
    tags: Prisma.JsonValue
    sortOrder: number
    launchCount: number
  })[]
  meta: { page: number; perPage: number; total: number }
}

@UseGuards(AuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
@Controller('admin')
export class CasinoAdminController {
  // В3: записи в таблицы каталога (gameProvider.update, game.update/create)
  // ушли в application/use-cases — контроллер знает только про HTTP и
  // read-only выборки (чтение через prisma легально по ADR GAP-51).
  constructor(
    @Inject(AdminSetProviderEnabledUseCase)
    private readonly providerEnabledUc: AdminSetProviderEnabledUseCase,
    @Inject(AdminSyncProviderGamesUseCase)
    private readonly syncGamesUc: AdminSyncProviderGamesUseCase,
    @Inject(AdminUpdateGameUseCase) private readonly updateGameUc: AdminUpdateGameUseCase,
    @Inject(AdminSetGameFlagsUseCase) private readonly gameFlagsUc: AdminSetGameFlagsUseCase,
  ) {}

  // providers
  @Get('providers')
  async providersList(): Promise<
    {
      id: string
      createdAt: Date
      updatedAt: Date
      name: string
      type: GameProviderType
      slug: string
      isEnabled: boolean
      sortOrder: number
      apiUrl: string | null
      apiKey: string | null
      apiSecret: string | null
      config: Prisma.JsonValue
      logoUrl: string | null
      gameCount: number
    }[]
  > {
    return prisma.gameProvider.findMany({ orderBy: { sortOrder: 'asc' } })
  }
  @Post('providers/:id/enable')
  async providerEnable(@Param('id') providerId: string): Promise<{ ok: boolean }> {
    return this.providerEnabledUc.execute(providerId, true)
  }
  @Post('providers/:id/disable')
  async providerDisable(@Param('id') providerId: string): Promise<{ ok: boolean }> {
    return this.providerEnabledUc.execute(providerId, false)
  }
  // UC-GAME-19: синхронизация каталога через ProviderAdapter (цикл upsert'а
  // и запись gameCount — в AdminSyncProviderGamesUseCase)
  @Post('providers/:id/sync-games')
  async syncGames(@Param('id') providerId: string): Promise<ProviderGamesSyncResult> {
    return this.syncGamesUc.execute(providerId)
  }

  // games
  @Get('games')
  async games(@Query() queryParams: Record<string, string | undefined>): Promise<AdminGamesPage> {
    const page = parseInt(queryParams.page ?? '') || 1,
      perPage = Math.min(parseInt(queryParams.per_page ?? '') || 50, 200)
    const where: Prisma.GameWhereInput = {}
    if (queryParams.provider_id) {
      where.providerId = queryParams.provider_id
    }
    if (queryParams.is_enabled !== undefined) {
      where.isEnabled = queryParams.is_enabled === 'true'
    }
    if (queryParams.search) {
      where.OR = [
        { name: { contains: queryParams.search, mode: 'insensitive' } },
        { nameRu: { contains: queryParams.search, mode: 'insensitive' } },
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
    @Param('id') gameId: string,
    @Body()
    body: {
      name_ru?: string
      is_new?: boolean
      is_popular?: boolean
      isPopular?: boolean
      sort_order?: number
      tags?: string[]
    },
  ): Promise<{ ok: boolean }> {
    return this.updateGameUc.execute(gameId, body)
  }
  @Post('games/:id/enable')
  async gameEnable(@Param('id') gameId: string): Promise<{ ok: boolean }> {
    return this.gameFlagsUc.execute(gameId, { isEnabled: true })
  }
  @Post('games/:id/disable')
  async gameDisable(@Param('id') gameId: string): Promise<{ ok: boolean }> {
    return this.gameFlagsUc.execute(gameId, { isEnabled: false })
  }
  @Post('games/:id/feature')
  async gameFeature(@Param('id') gameId: string): Promise<{ ok: boolean }> {
    return this.gameFlagsUc.execute(gameId, { isFeatured: true })
  }
  @Post('games/:id/unfeature')
  async gameUnfeature(@Param('id') gameId: string): Promise<{ ok: boolean }> {
    return this.gameFlagsUc.execute(gameId, { isFeatured: false })
  }

  // game sessions
  @Get('game-sessions')
  async sessions(@Query() queryParams: Record<string, string | undefined>): Promise<{
    items: ({
      user: { email: string | null }
      game: { name: string; slug: string }
      provider: { name: string }
    } & {
      id: string
      ipAddress: string | null
      userAgent: string | null
      metadata: Prisma.JsonValue
      userId: string
      currency: string
      status: GameSessionStatus
      providerId: string
      gameId: string
      sessionToken: string
      isDemo: boolean
      startedAt: Date
      lastActivityAt: Date
      closedAt: Date | null
      totalBet: Prisma.Decimal
      totalWin: Prisma.Decimal
      roundsPlayed: number
    })[]
    meta: { page: number; perPage: number; total: number }
  }> {
    const page = parseInt(queryParams.page ?? '') || 1,
      perPage = Math.min(parseInt(queryParams.per_page ?? '') || 50, 200)
    const where: Prisma.GameSessionWhereInput = {}
    if (queryParams.user_id) {
      where.userId = queryParams.user_id
    }
    if (queryParams.game_id) {
      where.gameId = queryParams.game_id
    }
    if (queryParams.provider_id) {
      where.providerId = queryParams.provider_id
    }
    if (queryParams.status) {
      where.status = queryParams.status as GameSessionStatus
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
  async sessionDetail(@Param('id') id: string): Promise<AdminSessionDetail | null> {
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
  async gameTx(@Query() queryParams: Record<string, string | undefined>): Promise<{
    items: {
      id: string
      createdAt: Date
      type: GameTransactionType
      amount: Prisma.Decimal
      balanceAfter: Prisma.Decimal
      metadata: Prisma.JsonValue
      userId: string
      currency: string
      processed: boolean
      providerId: string
      sessionId: string
      roundId: string
      externalTransactionId: string
      ledgerEntryId: string | null
    }[]
    meta: { page: number; perPage: number; total: number }
  }> {
    const page = parseInt(queryParams.page ?? '') || 1,
      perPage = Math.min(parseInt(queryParams.per_page ?? '') || 50, 200)
    const where: Prisma.GameTransactionWhereInput = {}
    if (queryParams.user_id) {
      where.userId = queryParams.user_id
    }
    if (queryParams.provider_id) {
      where.providerId = queryParams.provider_id
    }
    if (queryParams.type) {
      where.type = queryParams.type as GameTransactionType
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
