import { Inject, Injectable } from '@nestjs/common'

import { BlockPlayerUseCase } from '../application/use-cases/block-player.use-case'
import { DeprovisionAffiliatePlayerUseCase } from '../application/use-cases/deprovision-affiliate-player.use-case'
import { GetGeoContextUseCase } from '../application/use-cases/get-geo-context.use-case'
import {
  type ProvisionAffiliatePlayerInput,
  ProvisionAffiliatePlayerUseCase,
  type ProvisionAffiliatePlayerResult,
} from '../application/use-cases/provision-affiliate-player.use-case'
import { UnblockPlayerUseCase } from '../application/use-cases/unblock-player.use-case'
import { UpdateAfterDepositUseCase } from '../application/use-cases/update-after-deposit.use-case'
import { UpdateCurrencyPreferenceUseCase } from '../application/use-cases/update-currency-preference.use-case'

import type { UserGeoContext } from '../domain/repositories/user-profile.repository'

@Injectable()
export class UsersFacade {
  constructor(
    @Inject(GetGeoContextUseCase) private getGeoContextUseCase: GetGeoContextUseCase,
    @Inject(UpdateCurrencyPreferenceUseCase)
    private updateCurrency: UpdateCurrencyPreferenceUseCase,
    @Inject(UpdateAfterDepositUseCase) private updateAfterDeposit: UpdateAfterDepositUseCase,
    @Inject(ProvisionAffiliatePlayerUseCase)
    private provisionAffiliatePlayerUseCase: ProvisionAffiliatePlayerUseCase,
    @Inject(DeprovisionAffiliatePlayerUseCase)
    private deprovisionAffiliatePlayerUseCase: DeprovisionAffiliatePlayerUseCase,
    @Inject(BlockPlayerUseCase) private blockPlayerUseCase: BlockPlayerUseCase,
    @Inject(UnblockPlayerUseCase) private unblockPlayerUseCase: UnblockPlayerUseCase,
  ) {}

  getGeoContext(userId: string): Promise<UserGeoContext | null> {
    return this.getGeoContextUseCase.execute(userId)
  }

  updateCurrencyPreference(
    userId: string,
    currency: string,
  ): Promise<{ currency_preference: string }> {
    return this.updateCurrency.execute(userId, currency)
  }

  onDepositCompleted(userId: string, currency: string, method: string): Promise<void> {
    return this.updateAfterDeposit.execute(userId, currency, method)
  }

  /**
   * GAP-62: создать служебную user-запись партнёра (email=null, status=active,
   * referral_code уникален). Публичный способ получить `users.id` для
   * `affiliates.user_id` — раньше INSERT делал сам affiliate (ADR GAP-51
   * разрешает ему только чтение чужих таблиц).
   */
  provisionAffiliatePlayer(
    input: ProvisionAffiliatePlayerInput,
  ): Promise<ProvisionAffiliatePlayerResult> {
    return this.provisionAffiliatePlayerUseCase.execute(input)
  }

  /**
   * GAP-62: удалить служебную user-запись, ставшую сиротой (запись партнёра не
   * состоялась). Удаляется только строка без email — чужой аккаунт игрока под
   * этот метод не подпадёт.
   */
  deprovisionAffiliatePlayer(userId: string): Promise<void> {
    return this.deprovisionAffiliatePlayerUseCase.execute(userId)
  }

  /**
   * Блокировка игрока: `status='blocked'` + отзыв активных сессий, атомарно.
   *
   * G24: раньше эти две записи делал `admin` из своего репозитория, то есть
   * писал в чужие таблицы `users` и `sessions`. Правило «заблокирован — значит
   * без живых сессий» теперь живёт здесь, вместе с данными.
   */
  blockPlayer(userId: string): Promise<void> {
    return this.blockPlayerUseCase.execute(userId)
  }

  /** Разблокировка: только статус, отозванные сессии не возвращаются. */
  unblockPlayer(userId: string): Promise<void> {
    return this.unblockPlayerUseCase.execute(userId)
  }
}
