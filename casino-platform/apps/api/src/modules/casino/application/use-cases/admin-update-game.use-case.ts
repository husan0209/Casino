import { Inject, Injectable } from '@nestjs/common'
import { type Prisma } from '@prisma/client'

import {
  GAME_CATALOG_REPOSITORY,
  type IGameCatalogRepository,
} from '../../domain/repositories/casino.repository'

/**
 * Вход PATCH /admin/games/:id (UC-GAME-18). Форма — snake_case запроса плюс
 * исторический `isPopular`: GAP-21 принимал оба написания, поэтому маппинг
 * ниже сохранён 1-в-1, а не «починен».
 */
export interface AdminGameUpdateInput {
  name_ru?: string | undefined
  is_new?: boolean | undefined
  is_popular?: boolean | undefined
  isPopular?: boolean | undefined
  sort_order?: number | undefined
  tags?: string[] | undefined
}

/**
 * UC-GAME-18: правка карточки игры админом. В3 — запись в games уходила
 * прямо из контроллера; здесь остаются и маппинг snake_case → колонки, и
 * контракт «не переданное поле не трогаем».
 */
@Injectable()
export class AdminUpdateGameUseCase {
  constructor(@Inject(GAME_CATALOG_REPOSITORY) private readonly catalog: IGameCatalogRepository) {}

  async execute(gameId: string, input: AdminGameUpdateInput): Promise<{ ok: boolean }> {
    await this.catalog.updateGame(gameId, this.toUpdateData(input))
    return { ok: true }
  }

  private toUpdateData(input: AdminGameUpdateInput): Prisma.GameUncheckedUpdateInput {
    const data: Prisma.GameUncheckedUpdateInput = {}
    if (input.name_ru !== undefined) {
      data.nameRu = input.name_ru
    }
    if (input.is_new !== undefined) {
      data.isNew = input.is_new
    }
    // Quirk прежнего контракта: isPopular сам по себе не пишется — только как
    // переопределение is_popular (если прислан один isPopular, изменения нет).
    if (input.is_popular !== undefined) {
      data.isPopular = input.isPopular ?? input.is_popular
    }
    if (input.sort_order !== undefined) {
      data.sortOrder = input.sort_order
    }
    if (input.tags !== undefined) {
      data.tags = input.tags
    }
    return data
  }
}
