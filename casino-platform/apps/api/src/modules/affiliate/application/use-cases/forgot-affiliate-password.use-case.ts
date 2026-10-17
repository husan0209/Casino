/**
 * Запрос восстановления пароля партнёра (ТЗ ч.8 §658).
 *
 * Отдельный флоу от `auth/forgot-password` не по небрежности: партнёрский хеш
 * лежит в `affiliates`, а компаньон-строка игрока заводится с `email: null`
 * (`users/application/use-cases/provision-affiliate-player.use-case.ts`),
 * поэтому `users.findByEmail` партнёра не находит и письмо не уходит вообще.
 *
 * Ответ одинаков для известного и неизвестного адреса: иначе форма становится
 * оракулом «есть ли тут партнёр», а партнёрская база — ценная мишень.
 */
import { randomBytes } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'

import { EMAIL_QUEUE_PORT, type EmailQueuePort } from '@/queues/queue.types'
import { renderPasswordResetEmail } from '@/queues/templates'

import {
  AFFILIATE_REPOSITORY,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'

/** Час — столько же, сколько живёт игрецкая ссылка (forgot-password.use-case). */
export const AFFILIATE_RESET_TTL_MS = 60 * 60 * 1000

export interface ForgotAffiliatePasswordResult {
  message: string
}

@Injectable()
export class ForgotAffiliatePasswordUseCase {
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(EMAIL_QUEUE_PORT) private readonly emailQueue: EmailQueuePort,
  ) {}

  async execute(email: string): Promise<ForgotAffiliatePasswordResult> {
    const affiliate = await this.affiliates.findByEmail(email.toLowerCase().trim())

    // Приостановленному партнёру ссылку не шлём: войти он не сможет всё равно,
    // а письмо «вот ваш пароль» по неактивному аккаунту — обещание, которое мы
    // не выполним. Ответ при этом остаётся тем же самым.
    if (affiliate !== null && affiliate.status === 'active') {
      const token = randomBytes(64).toString('hex')
      await this.affiliates.setPasswordResetToken(
        affiliate.id,
        token,
        new Date(Date.now() + AFFILIATE_RESET_TTL_MS),
      )
      const mail = renderPasswordResetEmail(`${this.baseUrl()}/affiliate/reset-password?token=${token}`)
      await this.emailQueue.enqueue({
        to: affiliate.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      })
    }

    return { message: 'If email exists, you will receive a link' }
  }

  private baseUrl(): string {
    return (process.env['APP_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')
  }
}
