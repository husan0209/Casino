import { Inject, Injectable } from '@nestjs/common'

import { OriginalsSessionLoader } from './originals-session-loader'
import { type TigerIconDoc } from '../../domain/house-slot-game'
import { FORTUNE_TIGER_ICONS } from '../../infrastructure/providers/house/spin-data/fortune-tiger.tables'
import { TigerIconDocSchema } from '../../infrastructure/providers/house/spin-data/tiger-spin-row'

/**
 * Paytable house-слота. Донор отдаёт её открытым GET без проверки
 * токена (FortunetigerController::icons) — зеркалим: таблица статична,
 * секретов нет. Демо-токен без игры — дефолт тигра (демо визуальное).
 */
@Injectable()
export class OriginalsIconsUseCase {
  constructor(
    @Inject(OriginalsSessionLoader) private readonly sessionLoader: OriginalsSessionLoader,
  ) {}

  async execute(sessionToken: string): Promise<TigerIconDoc> {
    if (this.sessionLoader.isDemoToken(sessionToken)) {
      return TigerIconDocSchema.parse(FORTUNE_TIGER_ICONS)
    }
    const { game } = await this.sessionLoader.loadActiveSlotSession(sessionToken)
    return TigerIconDocSchema.parse(game.icons)
  }
}
