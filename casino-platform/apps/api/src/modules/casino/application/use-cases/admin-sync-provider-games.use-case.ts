import { Inject, Injectable } from '@nestjs/common'
import { type GameCategory, type GameType, type Prisma } from '@prisma/client'

import { PROVIDER_ADAPTER_FACTORY, type IProviderAdapterFactory } from '../../domain/casino.ports'
import { CasinoEntityNotFoundError } from '../../domain/errors'
import { type ProviderGameRow } from '../../domain/provider-adapter.interface'
import {
  GAME_CATALOG_REPOSITORY,
  GAME_PROVIDER_REPOSITORY,
  type IGameCatalogRepository,
  type IGameProviderRepository,
} from '../../domain/repositories/casino.repository'
import { gameSlug } from '../../domain/value-objects/game-slug'

/** Ответ POST /admin/providers/:id/sync-games (HTTP-контракт заморожен). */
export interface ProviderGamesSyncResult {
  added: number
  updated: number
  total: number
  note: string
}

/** Колонки каталога, которые провайдер даёт о своей игре (нормализация). */
type ProviderCatalogFields = Pick<
  Prisma.GameUncheckedCreateInput,
  'name' | 'type' | 'category' | 'thumbnailUrl' | 'hasDemo' | 'rtp' | 'metadata'
>

const SYNC_NOTE = 'Новые игры добавлены выключенными — включите нужные в разделе «Игры»'

/**
 * UC-GAME-19 (ТЗ ч.4): синхронизация каталога провайдера.
 *
 * В3: три записи (`game.update`, `game.create`, `gameProvider.gameCount`) и
 * весь цикл upsert'а жили в контроллере. Правила отсюда — «новую игру
 * создаём ВЫКЛЮЧЕННОЙ» и «slug = имя + хэш пары» — бизнес-правила, поэтому
 * они в application/domain, а не в HTTP-слое.
 *
 * Последовательность вызовов сохранена прежней (строки каталога пишутся по
 * одной, без $transaction): синхронизация не трогает money-контур, а частичный
 * результат при обрыве — прежнее поведение, менять его в этой волне нельзя.
 */
@Injectable()
export class AdminSyncProviderGamesUseCase {
  constructor(
    @Inject(GAME_PROVIDER_REPOSITORY) private readonly providers: IGameProviderRepository,
    @Inject(GAME_CATALOG_REPOSITORY) private readonly catalog: IGameCatalogRepository,
    @Inject(PROVIDER_ADAPTER_FACTORY) private readonly adapters: IProviderAdapterFactory,
  ) {}

  async execute(providerId: string): Promise<ProviderGamesSyncResult> {
    const provider = await this.providers.findById(providerId)
    if (!provider) {
      throw new CasinoEntityNotFoundError('NOT_FOUND')
    }
    const rows = await this.adapters.getAdapter(provider.slug).fetchGameList()

    let added = 0
    let updated = 0
    for (const row of rows) {
      if (await this.upsertRow(provider.id, provider.slug, row)) {
        updated++
      } else {
        added++
      }
    }

    const total = await this.catalog.count({ providerId: provider.id })
    await this.providers.setGameCount(provider.id, total)
    return { added, updated, total, note: SYNC_NOTE }
  }

  /**
   * Одна строка каталога: правка существующей игры либо создание новой.
   * @returns true — игра уже была (обновили), false — добавили.
   */
  private async upsertRow(
    providerId: string,
    providerSlug: string,
    row: ProviderGameRow,
  ): Promise<boolean> {
    const fields = this.catalogFields(row)
    const existing = await this.catalog.findByProviderAndExternalGameId(
      providerId,
      row.externalGameId,
    )
    if (existing) {
      await this.catalog.updateGame(existing.id, fields)
      return true
    }
    // UC-GAME-19 правило: новые игры добавляются ВЫКЛЮЧЕННЫМИ.
    await this.catalog.createGame({
      ...fields,
      providerId,
      externalGameId: row.externalGameId,
      slug: gameSlug(providerSlug, row.externalGameId, row.name),
      isEnabled: false,
    })
    return false
  }

  /** Нормализация строки провайдера: значения по умолчанию и rtp строкой (G20). */
  private catalogFields(row: ProviderGameRow): ProviderCatalogFields {
    return {
      name: row.name || row.externalGameId,
      type: (row.type ?? 'slot') as GameType,
      category: (row.category ?? 'slots') as GameCategory,
      thumbnailUrl: row.thumbnailUrl ?? null,
      hasDemo: row.hasDemo,
      rtp: row.rtp !== undefined ? String(row.rtp) : null,
      metadata: (row.metadata ?? {}) as Prisma.InputJsonValue,
    }
  }
}
