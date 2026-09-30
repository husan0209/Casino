/**
 * Вход партнёра (UC-AFF-02, ТЗ ч.8 §9).
 *
 * Партнёры с неактивным статусом (suspended/rejected) входить НЕ могут:
 * приостановка партнёра должна прекращать его работу, а не только скрывать
 * рекламу. Возврат общей ошибки CredentialsInvalid и для неверного пароля, и
 * для suspended-партнёра не раскрывает клиенту, что аккаунт вообще существует.
 */
import { Inject, Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

import {
  AffiliateCredentialsInvalidError,
  AffiliateNotActiveError,
} from '../../domain/errors/affiliate.errors'
import {
  AFFILIATE_REPOSITORY,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'
import { AffiliateJwtService } from '../../infrastructure/affiliate-jwt.service'

export interface LoginAffiliateInput {
  email: string
  password: string
}

export interface LoginAffiliateResult {
  affiliateId: string
  trackingCode: string
  trackingUrl: string
  revshareRate: string
  status: string
  accessToken: string
}

@Injectable()
export class LoginAffiliateUseCase {
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AffiliateJwtService) private readonly jwt: AffiliateJwtService,
  ) {}

  async execute(input: LoginAffiliateInput): Promise<LoginAffiliateResult> {
    const affiliate = await this.affiliates.findByEmail(input.email.toLowerCase().trim())
    if (affiliate === null) {
      // Считаем хеш всё равно: иначе время ответа выдаёт, существует ли email
      // (timing-атакa на перебор адресов).
      await argon2.hash(input.password).catch(() => undefined)
      throw new AffiliateCredentialsInvalidError()
    }
    const valid = await argon2.verify(affiliate.passwordHash, input.password).catch(() => false)
    if (!valid) {
      throw new AffiliateCredentialsInvalidError()
    }
    if (affiliate.status !== 'active') {
      throw new AffiliateNotActiveError(affiliate.trackingCode)
    }

    await this.affiliates.touchLastLogin(affiliate.id)
    return {
      affiliateId: affiliate.id,
      trackingCode: affiliate.trackingCode,
      trackingUrl: this.buildTrackingUrl(affiliate.trackingCode),
      revshareRate: affiliate.revshareRate,
      status: affiliate.status,
      accessToken: this.jwt.signAccess(affiliate.id, affiliate.email),
    }
  }

  private buildTrackingUrl(trackingCode: string): string {
    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000'
    return `${appUrl.replace(/\/+$/, '')}/go/${trackingCode}`
  }
}
