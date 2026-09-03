import { Inject, Injectable } from '@nestjs/common'
import { type ConfigService } from '@nestjs/config'

import { EMAIL_QUEUE_PORT, type EmailQueuePort, type EnqueueResult } from '@/queues/queue.types'

/**
 * Продюсер писей аутентификации (verify-email / reset-password).
 * Постановка в очередь `email` через QueuesModule (GAP-02);
 * фактическая отправка — EmailWorker → MailerPort (SMTP в prod, лог в dev).
 */
@Injectable()
export class EmailQueueService {
  constructor(
    private config: ConfigService,
    @Inject(EMAIL_QUEUE_PORT) private readonly emailQueue: EmailQueuePort,
  ) {}

  private base(): string {
    return this.config.get<string>('APP_URL') || 'http://localhost:3000'
  }

  sendVerificationEmail(to: string, token: string): Promise<EnqueueResult> {
    const link = `${this.base()}/verify-email?token=${token}`
    return this.emailQueue.enqueue({
      to,
      subject: 'Подтвердите ваш email',
      text: `Здравствуйте!\n\nПодтвердите ваш email по ссылке:\n${link}\n\nСсылка действительна 24 часа.`,
      html: `<p>Здравствуйте!</p><p>Подтвердите ваш email: <a href="${link}">${link}</a></p>`,
    })
  }

  sendPasswordReset(to: string, token: string): Promise<EnqueueResult> {
    const link = `${this.base()}/reset-password?token=${token}`
    return this.emailQueue.enqueue({
      to,
      subject: 'Сброс пароля',
      text: `Вы запросили сброс пароля.\nСсылка для сброса:\n${link}\n\nЕсли это не вы — проигнорируйте письмо.`,
      html: `<p>Вы запросили сброс пароля.</p><p><a href="${link}">Сбросить пароль</a></p><p>Если это не вы — проигнорируйте письмо.</p>`,
    })
  }
}
