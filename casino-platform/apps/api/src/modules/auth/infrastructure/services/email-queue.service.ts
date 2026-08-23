import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AppError } from '@casino/shared-utils'

export class EmailNotConfiguredError extends AppError {
  readonly code = 'EMAIL_NOT_CONFIGURED'
  readonly httpStatus = 500
  constructor() { super('SMTP не настроен: письма не могут быть отправлены') }
}

/**
 * Постановка писем в очередь.
 *
 * MVP-статус (см. docs/IMPLEMENTATION_GAPS.md GAP-02/GAP-05):
 * - development: письмо пишется в лог со ссылкой — флоу проверяемы без Redis/SMTP.
 * - production: без SMTP_HOST — fail-closed (EmailNotConfiguredError), как и платёжные клиенты.
 * - BullMQ-воркер `email` добавляется отдельной задачей (queues.module), продюсер ниже оставлен за интерфейсом.
 */
@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name)

  constructor(private config: ConfigService) {}

  private async enqueue(to: string, subject: string, text: string): Promise<void> {
    const env = this.config.get<string>('NODE_ENV')
    const smtpHost = this.config.get<string>('SMTP_HOST')
    if (env === 'production' && !smtpHost) throw new EmailNotConfiguredError()
    // TODO(GAP-02): await this.emailQueue.add('send', { to, subject, html }) через BullMQ
    this.logger.log(`EMAIL[dev] to=${to} subject="${subject}" ${text}`)
  }

  sendVerificationEmail(to: string, token: string) {
    const base = this.config.get<string>('APP_URL') || 'http://localhost:3000'
    return this.enqueue(to, 'Подтвердите ваш email', `${base}/verify-email?token=${token}`)
  }

  sendPasswordReset(to: string, token: string) {
    const base = this.config.get<string>('APP_URL') || 'http://localhost:3000'
    return this.enqueue(to, 'Сброс пароля', `${base}/reset-password?token=${token}`)
  }
}
