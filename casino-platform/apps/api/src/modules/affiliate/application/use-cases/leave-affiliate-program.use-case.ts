/**
 * UC-AFF-16: выход партнёра из программы (self-service, ТЗ ч.8 §10.2).
 *
 * ВОЛНА В3: `affiliate.controller.ts` сам вызывал `affiliates.update(...)` —
 * запись из presentation-слоя.
 *
 * ПОЛИТИКА (сохранена без изменений): статус `suspended`, а не `rejected`.
 * Партнёр может вернуться, накопленная статистика и начисления не отзываются:
 * это отказ от работы, а не санкция. Причина фиксируется в `suspended_reason`
 * одинаковой строкой — по ней аудит и разбор спорных случаев различают
 * self-service выход и админскую блокировку.
 */
import { Inject, Injectable } from '@nestjs/common'

import { AffiliateNotFoundError } from '../../domain/errors/affiliate.errors'
import {
  AFFILIATE_REPOSITORY,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'

import type { AffiliateEntity } from '../../domain/entities/affiliate.entity'

/** Причина выхода, которую видят админы в suspended_reason. */
const SELF_SERVICE_LEAVE_REASON = 'self-service leave'

@Injectable()
export class LeaveAffiliateProgramUseCase {
  constructor(@Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository) {}

  async execute(input: { affiliateId: string }): Promise<AffiliateEntity> {
    const affiliate = await this.affiliates.findById(input.affiliateId)
    if (affiliate === null) {
      throw new AffiliateNotFoundError(input.affiliateId)
    }
    return await this.affiliates.update(affiliate.id, {
      status: 'suspended',
      suspendedReason: SELF_SERVICE_LEAVE_REASON,
    })
  }
}
