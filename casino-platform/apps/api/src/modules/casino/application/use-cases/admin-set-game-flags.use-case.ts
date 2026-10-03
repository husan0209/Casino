import { Inject, Injectable } from '@nestjs/common'
import { type Prisma } from '@prisma/client'

import {
  GAME_CATALOG_REPOSITORY,
  type IGameCatalogRepository,
} from '../../domain/repositories/casino.repository'

/** Флаг витрины, которым управляет админ-контур (UC-GAME-18). */
export type AdminGameFlag = 'isEnabled' | 'isFeatured'

/** Набор флагов одной строки каталога: непустой, иначе правки нет. */
export type AdminGameFlags = Partial<Record<AdminGameFlag, boolean>>

/**
 * UC-GAME-18: четыре endpoint'а каталога (enable/disable/feature/unfeature)
 * раньше писали в games прямо из контроллера. Бизнес-действие одно —
 * «выставить флаг витрины», поэтому один use-case: различия сводятся к
 * значению флага, который передаёт контроллер.
 */
@Injectable()
export class AdminSetGameFlagsUseCase {
  constructor(@Inject(GAME_CATALOG_REPOSITORY) private readonly catalog: IGameCatalogRepository) {}

  async execute(gameId: string, flags: AdminGameFlags): Promise<{ ok: boolean }> {
    await this.catalog.updateGame(gameId, this.toUpdateData(flags))
    return { ok: true }
  }

  /**
   * Только переданные флаги уходят в Prisma (exactOptionalPropertyTypes):
   * отсутствует ключ — колонка не меняется, false — пишется false.
   */
  private toUpdateData(flags: AdminGameFlags): Prisma.GameUncheckedUpdateInput {
    return {
      ...(flags.isEnabled !== undefined && { isEnabled: flags.isEnabled }),
      ...(flags.isFeatured !== undefined && { isFeatured: flags.isFeatured }),
    }
  }
}
