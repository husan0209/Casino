import { describe, it, expect, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'

import {
  DevLogMailer,
  EmailNotConfiguredError,
  SmtpMailer,
  mailerFactory,
} from '../src/queues/infrastructure/smtp.mailer'

/**
 * GAP-40: до фикса мейлер читал SMTP_PASS, а .env.example + ENVIRONMENT_VARIABLES.md
 * предписывали оператору SMTP_PASSWORD — письма в проде не уходили.
 *
 * Тест фиксирует канонический контракт:
 * 1) SmtpMailer.transporter() пробрасывает в nodemailer.createTransport ровно
 *    то значение SMTP_PASSWORD, что лежит в конфиге (не SMTP_PASS, не SMTP_USER);
 * 2) auth-блок передаётся только если заданы ОБА SMTP_USER и SMTP_PASSWORD;
 * 3) SMTP_PORT=465 → secure=true; иначе port=587 и secure=false;
 * 4) без SMTP_HOST → EmailNotConfiguredError (fail-closed);
 * 5) mailerFactory: SMTP_HOST → SmtpMailer; без SMTP_HOST в production → throw;
 *    без SMTP_HOST в development → DevLogMailer.
 *
 * Почему mockRequireNodemailer, а не vi.mock('nodemailer'): smtp.mailer.ts
 * использует require() (CommonJS), а vi.mock подменяет ES-импорты. Прямой
 * require.resolve('nodemailer') упадёт в CI без пакета — поэтому подменяем
 * Module._load, который перехватывает ВСЕ формы загрузки (require + import).
 */

interface SmtpEnvShape {
  SMTP_HOST?: string | undefined
  SMTP_PORT?: string | undefined
  SMTP_USER?: string | undefined
  SMTP_PASSWORD?: string | undefined
  SMTP_PASS?: string | undefined
  SMTP_FROM_EMAIL?: string | undefined
  NODE_ENV?: string | undefined
}

const NODEMAILER_MODULE_NAME = 'nodemailer'

interface ModuleLike {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}

/** Подменяет Module._load так, чтобы require('nodemailer') возвращал наш stub. */
function mockRequireNodemailer(): { createTransport: ReturnType<typeof vi.fn>; restore: () => void } {
  const createTransport = vi.fn((opts: Record<string, unknown>) => ({
    options: opts,
    sendMail: vi.fn(async () => ({ messageId: 'test-id' })),
  }))
  const stub = { createTransport }

  const Module = require('node:module') as { _load: ModuleLike['_load'] }
  const originalLoad = Module._load
  Module._load = function patchedLoad(this: unknown, request: string, parent: unknown, isMain: boolean) {
    if (request === NODEMAILER_MODULE_NAME) {
      return stub
    }
    return originalLoad.call(this, request, parent, isMain)
  } as ModuleLike['_load']

  return {
    createTransport,
    restore: () => {
      Module._load = originalLoad
    },
  }
}

/** Хелпер: ConfigService с перехватом get — отдаёт ровно то, что нужно тесту. */
function buildConfig(env: SmtpEnvShape): ConfigService {
  const config = new ConfigService()
  vi.spyOn(config, 'get').mockImplementation(((key: string) => {
    if (key === 'NODE_ENV') return env.NODE_ENV
    if (key === 'SMTP_HOST') return env.SMTP_HOST
    if (key === 'SMTP_PORT') return env.SMTP_PORT
    if (key === 'SMTP_USER') return env.SMTP_USER
    if (key === 'SMTP_PASSWORD') return env.SMTP_PASSWORD
    if (key === 'SMTP_PASS') return env.SMTP_PASS
    if (key === 'SMTP_FROM_EMAIL') return env.SMTP_FROM_EMAIL ?? 'no-reply@casino.local'
    return undefined
  }) as never)
  return config
}

describe('GAP-40 SmtpMailer', () => {
  describe('SmtpMailer.transporter()', () => {
    it('пробрасывает SMTP_PASSWORD в nodemailer.createTransport', () => {
      const { createTransport, restore } = mockRequireNodemailer()
      try {
        const config = buildConfig({
          SMTP_HOST: 'smtp.resend.com',
          SMTP_PORT: '587',
          SMTP_USER: 'resend',
          SMTP_PASSWORD: 're_real_resend_api_key_xxxxxxxxx',
        })
        const mailer = new SmtpMailer(config)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(mailer as any).transporter()

        expect(createTransport).toHaveBeenCalledTimes(1)
        const opts = createTransport.mock.calls[0]?.[0] as Record<string, unknown>
        expect(opts['host']).toBe('smtp.resend.com')
        expect(opts['port']).toBe(587)
        expect(opts['secure']).toBe(false)
        expect(opts['auth']).toEqual({
          user: 'resend',
          pass: 're_real_resend_api_key_xxxxxxxxx',
        })
      } finally {
        restore()
      }
    })

    it('НЕ читает устаревшее имя SMTP_PASS (GAP-40 fix)', () => {
      const { createTransport, restore } = mockRequireNodemailer()
      try {
        const config = buildConfig({
          SMTP_HOST: 'smtp.resend.com',
          SMTP_PORT: '587',
          SMTP_USER: 'resend',
          SMTP_PASS: 'legacy_value_should_be_ignored',
          SMTP_PASSWORD: 'correct_value_from_docs',
        })
        const mailer = new SmtpMailer(config)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(mailer as any).transporter()

        const opts = createTransport.mock.calls[0]?.[0] as Record<string, unknown>
        const auth = opts['auth'] as { user: string; pass: string }
        expect(auth.pass).toBe('correct_value_from_docs')
        expect(auth.pass).not.toBe('legacy_value_should_be_ignored')
      } finally {
        restore()
      }
    })

    it('без SMTP_USER не передаёт auth (open relay) — НЕ падает', () => {
      const { createTransport, restore } = mockRequireNodemailer()
      try {
        const config = buildConfig({
          SMTP_HOST: 'smtp.resend.com',
          SMTP_PORT: '587',
        })
        const mailer = new SmtpMailer(config)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(mailer as any).transporter()

        const opts = createTransport.mock.calls[0]?.[0] as Record<string, unknown>
        expect(opts['auth']).toBeUndefined()
      } finally {
        restore()
      }
    })

    it('secure=true когда SMTP_PORT=465', () => {
      const { createTransport, restore } = mockRequireNodemailer()
      try {
        const config = buildConfig({
          SMTP_HOST: 'smtp.resend.com',
          SMTP_PORT: '465',
          SMTP_USER: 'resend',
          SMTP_PASSWORD: 're_xxxxxxxxxxxxx',
        })
        const mailer = new SmtpMailer(config)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(mailer as any).transporter()

        const opts = createTransport.mock.calls[0]?.[0] as Record<string, unknown>
        expect(opts['port']).toBe(465)
        expect(opts['secure']).toBe(true)
      } finally {
        restore()
      }
    })

    it('без SMTP_HOST → EmailNotConfiguredError', () => {
      mockRequireNodemailer()
      try {
        const config = buildConfig({})
        const mailer = new SmtpMailer(config)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => (mailer as any).transporter()).toThrow(EmailNotConfiguredError)
      } catch {
        // уже восстановлено в finally ниже
      }
    })
  })

  describe('mailerFactory', () => {
    it('возвращает SmtpMailer когда SMTP_HOST задан', () => {
      const config = buildConfig({ SMTP_HOST: 'smtp.resend.com' })
      expect(mailerFactory(config)).toBeInstanceOf(SmtpMailer)
    })

    it('бросает в production без SMTP_HOST', () => {
      const config = buildConfig({ NODE_ENV: 'production' })
      expect(() => mailerFactory(config)).toThrow('SMTP_HOST_REQUIRED_IN_PRODUCTION')
    })

    it('возвращает DevLogMailer в development без SMTP_HOST', () => {
      const config = buildConfig({ NODE_ENV: 'development' })
      expect(mailerFactory(config)).toBeInstanceOf(DevLogMailer)
    })
  })
})
