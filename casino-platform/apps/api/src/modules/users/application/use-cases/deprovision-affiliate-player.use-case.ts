/**
 * GAP-62: компенсационное удаление служебной user-записи партнёра.
 *
 * Вызывается, когда запись партнёра НЕ состоялась: без удаления в `users`
 * остаётся сирота — учётная запись без `affiliates`-строки, которая никогда
 * не удаляется. До переноса этот DELETE делал модуль affiliate, writes в
 * чужую таблицу ADR GAP-51 не разрешает (см. шапку
 * `affiliate/infrastructure/player-provisioning.prisma.repository.ts`).
 *
 * Удаление идемпотентно и НЕ бросает, если строки уже нет: вызов стоит в
 * catch-ветке, где главное — до клиента дошла исходная ошибка отказа
 * `affiliates.create`, а не вторая, поверх неё.
 *
 * Прачечной для произвольного DELETE метод не является намеренно: порт
 * удаляет только строку без email, то есть только служебную запись (см.
 * `IUserProfileRepository.deleteServiceUser`).
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  type IUserProfileRepository,
  USER_PROFILE_REPOSITORY,
} from '../../domain/repositories/user-profile.repository'

@Injectable()
export class DeprovisionAffiliatePlayerUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private readonly profiles: IUserProfileRepository) {}

  async execute(userId: string): Promise<void> {
    await this.profiles.deleteServiceUser(userId)
  }
}
