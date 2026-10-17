/**
 * Смена пароля партнёром из кабинета (ТЗ ч.8 §787).
 *
 * Требует текущий пароль: без него любая XSS или украденный токен кабинета
 * молча перекрывает учётку, и партнёр теряет доступ к выплатам. Проверка идёт
 * по тому же argon2-хешу, что и вход (`login-affiliate.use-case.ts`).
 */
import { Inject, Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

import {
  AffiliateNotFoundError,
  AffiliatePasswordInvalidCurrentError,
  AffiliatePasswordWeakError,
} from '../../domain/errors/affiliate.errors'
import {
  AFFILIATE_REPOSITORY,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'

/** Тот же минимум, что у регистрации партнёра (`AffiliatePasswordSchema`). */
export const AFFILIATE_PASSWORD_MIN_LENGTH = 8

export interface ChangeAffiliatePasswordInput {
  currentPassword: string
  newPassword: string
}

@Injectable()
export class ChangeAffiliatePasswordUseCase {
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
  ) {}

  async execute(affiliateId: string, input: ChangeAffiliatePasswordInput): Promise<{ ok: true }> {
    if (input.newPassword.length < AFFILIATE_PASSWORD_MIN_LENGTH) {
      throw new AffiliatePasswordWeakError(AFFILIATE_PASSWORD_MIN_LENGTH)
    }

    const affiliate = await this.affiliates.findById(affiliateId)
    if (affiliate === null) {
      throw new AffiliateNotFoundError(affiliateId)
    }

    const matches = await argon2
      .verify(affiliate.passwordHash, input.currentPassword)
      .catch(() => false)
    if (!matches) {
      throw new AffiliatePasswordInvalidCurrentError()
    }

    const hash = await argon2.hash(input.newPassword, { type: argon2.argon2id })
    await this.affiliates.updatePasswordHash(affiliate.id, hash)
    // Сбрасываем незавершённую ссылку восстановления: она выпущена для старого
    // пароля и после смены не должна оставаться рабочей.
    await this.affiliates.clearPasswordResetToken(affiliate.id)

    return { ok: true }
  }
}
