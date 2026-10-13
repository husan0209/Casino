import { Inject, Injectable } from '@nestjs/common'

import { OriginalsSessionLoader } from './originals-session-loader'
import { type TigerIconDoc } from '../../domain/house-slot-game'
import { TigerIconDocSchema } from '../../infrastructure/providers/house/spin-data/tiger-spin-row'

/**
 * Paytable house-слота. Донор отдаёт её открытым GET без проверки
 * токена (FortunetigerController::icons) — зеркалим: таблица статична,
 * секретов нет. Игра берётся из токена: у демо-токена нет сессии,
 * но paytable у каждой игры своя.
 */
@Injectable()
export class OriginalsIconsUseCase {
  constructor(
    @Inject(OriginalsSessionLoader) private readonly sessionLoader: OriginalsSessionLoader,
  ) {}

  async execute(sessionToken: string): Promise<TigerIconDoc> {
    if (this.sessionLoader.isDemoToken(sessionToken)) {
      return TigerIconDocSchema.parse(this.sessionLoader.loadDemoSlotGame(sessionToken).icons)
    }
    const { game } = await this.sessionLoader.loadActiveSlotSession(sessionToken)
    return TigerIconDocSchema.parse(game.icons)
  }
}
