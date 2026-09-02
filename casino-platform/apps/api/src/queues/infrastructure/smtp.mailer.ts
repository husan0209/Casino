import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { AppError } from '@casino/shared-utils'

import { type MailMessage, type MailerPort } from './mailer.port'

/** Минимальная структурная типизация nodemailer (optional peer, типы недоступны). */
interface SmtpTransport {
  sendMail(options: Record<string, unknown>): Promise<unknown>
}

import { ConfigService } from '@nestjs/config'

export class EmailNotConfiguredError extends AppError {
  readonly code = 'EMAIL_NOT_CONFIGURED'
  readonly httpStatus = 500
  constructor() {
    super('SMTP не настроен: письма не могут быть отправлены')
  }
}

@Injectable()
export class SmtpMailer implements MailerPort {
  private readonly logger = new Logger(SmtpMailer.name)
  private transport: SmtpTransport | null = null

  constructor(private config: ConfigService) {}

  /** nodemailer — optional peer: require ленивый, чтобы dev-среда без пакета собиралась. */
  private transporter(): SmtpTransport {
    if (this.transport) {
      return this.transport
    }
    let nodemailer: { createTransport: (opts: Record<string, unknown>) => Transporter }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      nodemailer = require('nodemailer')
    } catch {
      throw new EmailNotConfiguredError()
    }
    this.transport = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get('SMTP_PORT') || 587),
      secure: Number(this.config.get('SMTP_PORT')) === 465,
      auth: this.config.get('SMTP_USER')
        ? { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASS') }
        : undefined,
    })
    return this.transport
  }

  async send(msg: MailMessage) {
    if (!this.config.get<string>('SMTP_HOST')) {
      throw new EmailNotConfiguredError()
    }
    await this.transporter().sendMail({
      from: this.config.get<string>('SMTP_FROM_EMAIL') || 'no-reply@casino.local',
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    })
    this.logger.log(`SMTP sent: to=${msg.to} subject="${msg.subject}"`)
  }
}

@Injectable()
export class DevLogMailer implements MailerPort {
  private readonly logger = new Logger(DevLogMailer.name)
  constructor(config: ConfigService) {
    void config
  }
  async send(msg: MailMessage) {
    this.logger.log(`EMAIL[dev-mailer] to=${msg.to} subject="${msg.subject}"\n${msg.text}`)
  }
}

export function mailerFactory(config: ConfigService): MailerPort {
  if (config.get<string>('SMTP_HOST')) {
    return new SmtpMailer(config)
  }
  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error('SMTP_HOST_REQUIRED_IN_PRODUCTION')
  }
  return new DevLogMailer(config)
}
