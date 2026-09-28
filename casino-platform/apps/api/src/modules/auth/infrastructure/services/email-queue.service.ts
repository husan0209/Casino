import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { EMAIL_QUEUE_PORT, EmailQueuePort, type EnqueueResult } from '@/queues/queue.types'
import { renderPasswordResetEmail, renderVerificationEmail } from '@/queues/templates'

import { type IEmailQueueService } from '../../domain/auth.ports'

/**
 * Продюсер писей аутентификации (verify-email / reset-password).
 * Постановка в очередь `email` через QueuesModule (GAP-02);
 * фактическая отправка — EmailWorker → MailerPort (SMTP в prod, лог в dev).
 * Rich HTML (GAP-02 post-MVP) — через templates/; plain-text fallback сохранён.
 */
@Injectable()
export class EmailQueueService implements IEmailQueueService {
  constructor(
    private config: ConfigService,
    @Inject(EMAIL_QUEUE_PORT) private readonly emailQueue: EmailQueuePort,
  ) {}

  private base(): string {
    return this.config.get<string>('APP_URL') || 'http://localhost:3000'
  }

  sendVerificationEmail(to: string, token: string): Promise<EnqueueResult> {
    const link = `${this.base()}/verify-email?token=${token}`
    const mail = renderVerificationEmail(link)
    return this.emailQueue.enqueue({ to, subject: mail.subject, text: mail.text, html: mail.html })
  }

  sendPasswordReset(to: string, token: string): Promise<EnqueueResult> {
    const link = `${this.base()}/reset-password?token=${token}`
    const mail = renderPasswordResetEmail(link)
    return this.emailQueue.enqueue({ to, subject: mail.subject, text: mail.text, html: mail.html })
  }
}
