import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { OAuthUserProvisioningService } from './oauth-user-provisioning.service'
import { OAuthNotConfiguredError, OAuthExchangeError } from '../../../domain/errors'

const MAX_AUTH_AGE_SEC = 86_400 // виджет Telegram рекомендует отвергать данные старше суток

export interface TelegramWidgetPayload {
  id: number | string
  auth_date: number | string
  hash: string
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
}

/**
 * Telegram Login Widget — TZ part 2 §Telegram.
 * Верификация: secret = SHA256(bot_token); HMAC-SHA256(data-check-string) == hash.
 */
@Injectable()
export class TelegramLoginUseCase {
  constructor(
    private config: ConfigService,
    private provisioning: OAuthUserProvisioningService,
  ) {}

  private verify(payload: TelegramWidgetPayload): void {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN')
    if (!botToken) throw new OAuthNotConfiguredError('Telegram')

    const { hash, ...rest } = payload
    const dataCheckString = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${rest[k as keyof typeof rest]}`)
      .join('\n')

    const secret = createHash('sha256').update(botToken).digest()
    const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex')

    const a = Buffer.from(hash, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new OAuthExchangeError('подпись Telegram не совпадает')
    }

    const authDate = Number(payload.auth_date)
    if (!Number.isFinite(authDate) || Math.floor(Date.now() / 1000) - authDate > MAX_AUTH_AGE_SEC) {
      throw new OAuthExchangeError('данные виджета просрочены')
    }
  }

  async execute(input: TelegramWidgetPayload & { referralCode?: string }, meta?: { ip?: string; userAgent?: string }) {
    this.verify(input)
    const displayName = [input.first_name, input.last_name].filter(Boolean).join(' ') || input.username
    return this.provisioning.signIn({
      provider: 'telegram',
      providerUserId: String(input.id),
      displayName,
      referralCode: (input as any).referralCode,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    })
  }
}
