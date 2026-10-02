/**
 * UC-AFF-15: партнёр сам меняет анкету — только контакты (ТЗ ч.8 §10.2).
 *
 * ВОЛНА В3: `affiliate.controller.ts` вызывал `affiliates.updateSelf(...)`
 * напрямую, то есть presentation-слой писал в `affiliates`.
 *
 * Граница полномочий проверяется ЗДЕСЬ, а не только Zod-схемой: в порт уходит
 * только три поля (displayName/telegram/website). Ставку, статус и currency
 * партнёр не может изменить сам — это было бы самоповышение (ТЗ ч.8 §3.5),
 * поэтому `UpdateAffiliateSelfInput` физически не содержит этих полей.
 *
 * Проверка существования партнёра сохранена 1-в-1: прежний контроллер сначала
 * делал `requireAffiliate`, и 404 (`AFFILIATE_NOT_FOUND`) остаётся 404.
 */
import { Inject, Injectable } from '@nestjs/common'

import { AffiliateNotFoundError } from '../../domain/errors/affiliate.errors'
import {
  AFFILIATE_REPOSITORY,
  type AffiliateRepository,
  type UpdateAffiliateSelfInput,
} from '../../domain/repositories/affiliate.repository'

import type { AffiliateEntity } from '../../domain/entities/affiliate.entity'

@Injectable()
export class UpdateAffiliateProfileUseCase {
  constructor(@Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository) {}

  async execute(input: {
    affiliateId: string
    changes: UpdateAffiliateSelfInput
  }): Promise<AffiliateEntity> {
    const affiliate = await this.affiliates.findById(input.affiliateId)
    if (affiliate === null) {
      throw new AffiliateNotFoundError(input.affiliateId)
    }
    return await this.affiliates.updateSelf(affiliate.id, input.changes)
  }
}
