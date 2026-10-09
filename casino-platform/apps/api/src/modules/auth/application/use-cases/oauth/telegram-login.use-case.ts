import { createHash, createHmac, timingSafeEqual } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  type OAuthSignInResult,
  OAuthUserProvisioningService,
} from '@modules/auth/application/use-cases/oauth/oauth-user-provisioning.service'
import { OAuthExchangeError, OAuthNotConfiguredError } from '@modules/auth/domain/errors'

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
 * Именуемые поля профиля Telegram: их одинаково дают Login Widget (`id`,
 * `first_name`… в подписанном объекте) и Mini App (`user` внутри initData).
 */
export interface TelegramProfileNames {
  first_name?: string | undefined
  last_name?: string | undefined
  username?: string | undefined
}

/** Ответ /auth/telegram/preview: проверенный профиль + есть ли аккаунт. */
export interface TelegramPreviewResult {
  displayName: string | null
  username: string | null
  photoUrl: string | null
  accountExists: boolean
}

/** Имя игрока для отображения: «Иван Петров», иначе @username, иначе пусто. */
export function telegramDisplayName(names: TelegramProfileNames): string | null {
  return [names.first_name, names.last_name].filter(Boolean).join(' ') || names.username || null
}

/**
 * Telegram Login Widget — TZ part 2 §Telegram.
 * Верификация: secret = SHA256(bot_token); HMAC-SHA256(data-check-string) == hash.
 */
@Injectable()
export class TelegramLoginUseCase {
  constructor(
    @Inject(ConfigService) private config: ConfigService,
    @Inject(OAuthUserProvisioningService) private provisioning: OAuthUserProvisioningService,
  ) {}

  private verify(payload: TelegramWidgetPayload): void {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN')
    if (!botToken) {
      throw new OAuthNotConfiguredError('Telegram')
    }

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

  async execute(
    input: TelegramWidgetPayload & { referralCode?: string | undefined },
    meta?: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<OAuthSignInResult> {
    this.verify(input)
    return this.provisioning.signIn({
      provider: 'telegram',
      providerUserId: String(input.id),
      displayName: telegramDisplayName(input) ?? undefined,
      referralCode: input.referralCode,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    })
  }

  /**
   * Проверка подписи без выдачи сессии — экран подтверждения входа
   * («Продолжить как …», как у Google) показывает имя и статус аккаунта,
   * которого ещё нет в базе. Данные берём из проверенной подписи, а не из
   * query колбэка: иначе по ссылке `…/auth/telegram/callback?first_name=Админ`
   * наша же страница предлагала бы вход от имени выдуманного аккаунта.
   * Сессия не создаётся и не линкуется — игрок вправе отказаться.
   */
  async preview(input: TelegramWidgetPayload): Promise<TelegramPreviewResult> {
    this.verify(input)
    return {
      displayName: telegramDisplayName(input),
      username: input.username ?? null,
      photoUrl: input.photo_url ?? null,
      accountExists: await this.provisioning.hasAccount('telegram', String(input.id)),
    }
  }
}
