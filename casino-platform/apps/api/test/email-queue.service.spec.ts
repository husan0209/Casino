import { type ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'

import { EmailQueueService } from '../src/modules/auth/infrastructure/services/email-queue.service'

/**
 * Продюсер писем аутентификации.
 *
 * Проверяются два свойства, которые ломаются молча:
 *  1) ссылка строится от `APP_URL`. Если конфигурация не доехала до образа,
 *     письмо уходит с `http://localhost:3000/…` — пользователь получает
 *     нерабочую ссылку верификации и сброса пароля, а логи чистые;
 *  2) в очередь попадает и `text`, и `html`: часть клиентов и антиспам-фильтры
 *     требуют plain-text альтернативу, молча убрать её — значит терять доставку.
 */
interface Enqueued {
  to: string
  subject: string
  text: string
  html: string
}

function make(over: { APP_URL?: string } = {}) {
  const enqueued: Enqueued[] = []
  const emailQueue = {
    enqueue: vi.fn(async (mail: Enqueued) => {
      enqueued.push(mail)
      return { jobId: `job-${enqueued.length}`, queued: true }
    }),
  }
  const config = {
    get: (key: string) => (key === 'APP_URL' ? over.APP_URL : undefined),
  } as unknown as ConfigService

  return { svc: new EmailQueueService(config, emailQueue as never), enqueued, emailQueue }
}

describe('EmailQueueService.sendVerificationEmail', () => {
  it('ссылка верификации от APP_URL, токен в query', async () => {
    const h = make({ APP_URL: 'https://casino.example' })

    const res = await h.svc.sendVerificationEmail('p@example.com', 'tok-1')

    expect(res).toEqual({ jobId: 'job-1', queued: true })
    expect(h.enqueued[0]?.to).toBe('p@example.com')
    expect(h.enqueued[0]?.html).toContain('https://casino.example/verify-email?token=tok-1')
  })

  it('без APP_URL — резерв localhost:3000 (dev), а не undefined в письме', async () => {
    const h = make()

    await h.svc.sendVerificationEmail('p@example.com', 'tok-2')

    expect(h.enqueued[0]?.html).toContain('http://localhost:3000/verify-email?token=tok-2')
    expect(h.enqueued[0]?.html).not.toContain('undefined')
  })

  it('plain-text альтернатива обязательна и непуста', async () => {
    const h = make({ APP_URL: 'https://casino.example' })

    await h.svc.sendVerificationEmail('p@example.com', 'tok-3')

    const mail = h.enqueued[0]!
    expect(mail.text.length).toBeGreaterThan(0)
    expect(mail.subject.length).toBeGreaterThan(0)
    expect(mail.text).toContain('https://casino.example/verify-email?token=tok-3')
  })
})

describe('EmailQueueService.sendPasswordReset', () => {
  it('ссылка ведёт на /reset-password, а не на /verify-email', async () => {
    const h = make({ APP_URL: 'https://casino.example' })

    await h.svc.sendPasswordReset('p@example.com', 'tok-9')

    const mail = h.enqueued[0]!
    expect(mail.html).toContain('/reset-password?token=tok-9')
    expect(mail.html).not.toContain('/verify-email')
  })

  it('каждое письмо — один вызов enqueue с полным набором полей', async () => {
    const h = make({ APP_URL: 'https://casino.example' })

    await h.svc.sendPasswordReset('a@example.com', 't1')
    await h.svc.sendVerificationEmail('b@example.com', 't2')

    expect(h.emailQueue.enqueue).toHaveBeenCalledTimes(2)
    expect(Object.keys(h.enqueued[1]!).sort()).toEqual(['html', 'subject', 'text', 'to'])
  })
})
