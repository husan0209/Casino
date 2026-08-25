export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string | undefined
}

/** Порт отправки письма. Реализации: SmtpMailer (prod), DevLogMailer (dev). */
export interface MailerPort {
  send(msg: MailMessage): Promise<void>
}

export const MAILER_PORT = Symbol('MAILER_PORT')
