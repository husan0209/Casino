/**
 * GAP-62: создание служебной user-записи партнёра — на стороне владельца данных.
 *
 * До этой волны INSERT в `users` делал модуль affiliate
 * (`infrastructure/player-provisioning.prisma.repository.ts`), что ADR GAP-51
 * не разрешает: он даёт partner-модулю только ЧТЕНИЕ чужих таблиц. Запись
 * вернулась владельцу, и решение «какая это учётная запись» теперь живёт здесь,
 * в application-слое users, а не в инфраструктуре потребителя (MODULE_TEMPLATE:
 * бизнес-правило не в фасаде и не в контроллере).
 *
 * Семантика строки сохранена 1-в-1 (иначе поменялся бы HTTP-ответ эндпоинтов
 * `POST /affiliate/register` и `POST /admin/affiliates`):
 *  - `email: null` — рабочий адрес партнёра хранится в `affiliates.email`, а
 *    `users.email` под `@unique`: совпадение с адресом игрока (партнёр может
 *    играть сам) ломало бы регистрацию;
 *  - `status: 'active'` — служебная запись сразу активна, без подтверждения;
 *  - `referral_code` — колонка NOT NULL + @unique, значение передаёт
 *    потребитель уже уникальным (генерирует affiliate).
 *
 * Коллизию уникальности не перекрываем своей ошибкой: Prisma-ошибка уходит
 * наружу ровно так же, как из старого `prisma.user.create`, — код и статус
 * ответа заморожены контрактом.
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  type IUserProfileRepository,
  USER_PROFILE_REPOSITORY,
} from '../../domain/repositories/user-profile.repository'

export interface ProvisionAffiliatePlayerInput {
  /** Уникальный служебный реферальный код (префикс `aff` — см. генератора). */
  referralCode: string
}

export interface ProvisionAffiliatePlayerResult {
  /** id новой строки `users` — идёт в `affiliates.user_id`. */
  id: string
}

@Injectable()
export class ProvisionAffiliatePlayerUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private readonly profiles: IUserProfileRepository) {}

  async execute(input: ProvisionAffiliatePlayerInput): Promise<ProvisionAffiliatePlayerResult> {
    const created = await this.profiles.createServiceUser({
      email: null,
      status: 'active',
      referralCode: input.referralCode,
    })
    return { id: created.id }
  }
}
