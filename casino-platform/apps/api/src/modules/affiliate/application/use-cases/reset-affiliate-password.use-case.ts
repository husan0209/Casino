/**
 * Сброс пароля партнёра по ссылке из письма (ТЗ ч.8 §658).
 *
 * Токен одноразовый: успешный сброс снимает его ДО записи нового хеша нельзя —
 * порядок такой: проверили → записали хеш → сняли токен. Если между записью
 * хеша и снятием токена упасть, ссылка переживёт смену пароля, и это дыра
 * похуже «не сработало». Поэтому снятие идёт сразу после хеша, а оба шага —
 * в одной транзакции репозитория не требуются: это две независимые операции
 * над одной строкой, и вторая идемпотентна.
 *
 * Выпущенные JWT отзывать нечем: партнёрский токен stateless
 * (`affiliate-jwt.service.ts`, TTL `AFFILIATE_JWT_ACCESS_EXPIRES_IN`, по
 * умолчанию час). Сессий-таблицы у партнёров нет, так что украденный токен
 * доживает свой час и после сброса — известное ограничение, а не случайность.
 */
import { Inject, Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

import { AFFILIATE_PASSWORD_MIN_LENGTH } from './change-affiliate-password.use-case'
import {
  AffiliatePasswordWeakError,
  AffiliateResetTokenExpiredError,
  AffiliateResetTokenInvalidError,
} from '../../domain/errors/affiliate.errors'
import {
  AFFILIATE_REPOSITORY,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'

@Injectable()
export class ResetAffiliatePasswordUseCase {
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
  ) {}

  async execute(token: string, newPassword: string): Promise<{ ok: true }> {
    if (newPassword.length < AFFILIATE_PASSWORD_MIN_LENGTH) {
      throw new AffiliatePasswordWeakError(AFFILIATE_PASSWORD_MIN_LENGTH)
    }

    const record = await this.affiliates.findByResetToken(token)
    if (record === null) {
      throw new AffiliateResetTokenInvalidError()
    }
    if (record.tokenExpiresAt === null || record.tokenExpiresAt < new Date()) {
      await this.affiliates.clearPasswordResetToken(record.affiliateId)
      throw new AffiliateResetTokenExpiredError()
    }

    const hash = await argon2.hash(newPassword, { type: argon2.argon2id })
    await this.affiliates.updatePasswordHash(record.affiliateId, hash)
    await this.affiliates.clearPasswordResetToken(record.affiliateId)

    return { ok: true }
  }
}
