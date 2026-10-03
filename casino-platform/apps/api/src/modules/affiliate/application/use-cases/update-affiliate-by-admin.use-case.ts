/**
 * UC-AFF-18/19: админ меняет партнёра — индивидуальную ставку, статус,
 * контакты (ТЗ ч.8 §11.2).
 *
 * ВОЛНА В3: запись `affiliates.update(...)` вызывалась из
 * `affiliate-admin.controller.ts`. Перенесена сюда вместе с проверкой
 * существования партнёра и разбором ставки.
 *
 * ИЗМЕНЕНИЕ СТАВКИ НЕ ПРИМЕНЯЕТСЯ ЗАДНИМ ЧИСЛОМ: уже рассчитанные начисления
 * хранят снимок `revshare_rate`, новая ставка действует со следующего периода
 * (ТЗ ч.8 §11.2) — поэтому для аудита важно различать «в запросе была ставка»
 * и «просто обновили анкету»: флаг `rateRequested` сохраняет прежний предикат
 * контроллера (`body.revshareRate !== undefined`), а не сравнение old/new.
 */
import { Inject, Injectable } from '@nestjs/common'

import { AffiliateNotFoundError } from '../../domain/errors/affiliate.errors'
import {
  AFFILIATE_REPOSITORY,
  type AffiliateRepository,
  type UpdateAffiliateAdminInput,
} from '../../domain/repositories/affiliate.repository'
import { parseRevShareRate } from '../../domain/value-objects/revshare-rate.value-object'

import type { AffiliateEntity } from '../../domain/entities/affiliate.entity'

export interface UpdateAffiliateByAdminInput {
  affiliateId: string
  /** Поля админ-эндпоинта; `revshareRate` — строкой, разбирается здесь. */
  changes: Omit<UpdateAffiliateAdminInput, 'revshareRate'> & {
    revshareRate?: string | undefined
  }
}

export interface UpdateAffiliateByAdminResult {
  affiliate: AffiliateEntity
  /** Снимок «до» — нужен аудиту для пары from/to (ТЗ ч.8 §3.7). */
  previous: { revshareRate: string; status: string }
  /** Ставка была в запросе → аудит-экшен `affiliate.rate.changed`. */
  rateRequested: boolean
}

@Injectable()
export class UpdateAffiliateByAdminUseCase {
  constructor(@Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository) {}

  async execute(input: UpdateAffiliateByAdminInput): Promise<UpdateAffiliateByAdminResult> {
    const affiliate = await this.affiliates.findById(input.affiliateId)
    if (affiliate === null) {
      throw new AffiliateNotFoundError(input.affiliateId)
    }

    const { revshareRate, ...rest } = input.changes
    const updated = await this.affiliates.update(affiliate.id, {
      ...rest,
      ...(revshareRate !== undefined ? { revshareRate: parseRevShareRate(revshareRate) } : {}),
    })

    return {
      affiliate: updated,
      previous: { revshareRate: affiliate.revshareRate, status: affiliate.status },
      rateRequested: revshareRate !== undefined,
    }
  }
}
