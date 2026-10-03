import { Inject, Injectable } from '@nestjs/common'

import {
  GAME_PROVIDER_REPOSITORY,
  type IGameProviderRepository,
} from '../../domain/repositories/casino.repository'

/**
 * UC-GAME-17 (ТЗ ч.4): включение/выключение провайдера админ-контура.
 *
 * В3: два endpoint'а (enable/disable) раньше делали `prisma.gameProvider.update`
 * прямо из контроллера. Один use-case на бизнес-действие «сменить состояние
 * провайдера», потому что различаются они только значением флага.
 *
 * Поведение сохранено 1-в-1: неизвестный id даёт ту же ошибку Prisma
 * (P2025 → 500 через GlobalExceptionFilter), проверки существования здесь нет.
 */
@Injectable()
export class AdminSetProviderEnabledUseCase {
  constructor(
    @Inject(GAME_PROVIDER_REPOSITORY) private readonly providers: IGameProviderRepository,
  ) {}

  async execute(providerId: string, isEnabled: boolean): Promise<{ ok: boolean }> {
    await this.providers.setEnabled(providerId, isEnabled)
    return { ok: true }
  }
}
