/**
 * Восстановление и смена пароля партнёра (ТЗ ч.8 §658, §787).
 *
 * До этой правды партнёр, забывший пароль, доступа к кабинету не имел:
 * `auth/forgot-password` ищет аккаунт в `users` по почте, а компаньон-строка
 * партнёра заведена с `email: null` — то есть письмо не уходило никогда, а
 * ссылки «забыли пароль» на `/affiliate/login` даже не было. Спека держит то,
 * что в этом флоу легко сломать молча: анти-перечисление, срок токена,
 * одноразовость и то, что смена пароля требует текущий.
 */
import * as argon2 from 'argon2'
import { describe, expect, it, vi } from 'vitest'

import { ChangeAffiliatePasswordUseCase } from '../src/modules/affiliate/application/use-cases/change-affiliate-password.use-case'
import {
  AFFILIATE_RESET_TTL_MS,
  ForgotAffiliatePasswordUseCase,
} from '../src/modules/affiliate/application/use-cases/forgot-affiliate-password.use-case'
import { ResetAffiliatePasswordUseCase } from '../src/modules/affiliate/application/use-cases/reset-affiliate-password.use-case'
import {
  AffiliatePasswordInvalidCurrentError,
  AffiliateResetTokenExpiredError,
  AffiliateResetTokenInvalidError,
} from '../src/modules/affiliate/domain/errors/affiliate.errors'

import type { AffiliateEntity } from '../src/modules/affiliate/domain/entities/affiliate.entity'
import type {
  AffiliatePasswordResetRecord,
  AffiliateRepository,
} from '../src/modules/affiliate/domain/repositories/affiliate.repository'
import type { EmailQueuePort } from '../src/queues/queue.types'

const KNOWN = 'partner@example.com'

interface Harness {
  affiliates: AffiliateRepository
  emailQueue: EmailQueuePort
  calls: {
    setToken: Array<{ id: string; token: string; expiresAt: Date }>
    cleared: string[]
    hashed: Array<{ id: string; hash: string }>
    sent: Array<{ to: string; text: string }>
  }
}

function makeHarness(over: {
  affiliate?: AffiliateEntity | null
  resetRecord?: AffiliatePasswordResetRecord | null
}): Harness {
  const calls = { setToken: [] as Harness['calls']['setToken'], cleared: [] as string[], hashed: [] as Harness['calls']['hashed'], sent: [] as Harness['calls']['sent'] }
  const affiliate = over.affiliate === undefined ? null : over.affiliate

  const affiliates = {
    findByEmail: async () => affiliate,
    findById: async () => affiliate,
    findByResetToken: async () => over.resetRecord ?? null,
    setPasswordResetToken: async (id: string, token: string, expiresAt: Date) => {
      calls.setToken.push({ id, token, expiresAt })
    },
    clearPasswordResetToken: async (id: string) => {
      calls.cleared.push(id)
    },
    updatePasswordHash: async (id: string, hash: string) => {
      calls.hashed.push({ id, hash })
    },
  } as unknown as AffiliateRepository

  const emailQueue = {
    enqueue: async (job: { to: string; text: string }) => {
      calls.sent.push(job)
      return 'queued' as const
    },
  } as unknown as EmailQueuePort

  return { affiliates, emailQueue, calls }
}

function entity(over: Partial<AffiliateEntity> = {}): AffiliateEntity {
  return {
    id: 'a-1',
    userId: 'u-1',
    email: KNOWN,
    passwordHash: 'unused-hash',
    status: 'active',
    trackingCode: 'W5LVUGKE',
    revshareRate: '0.2000',
    ...over,
  } as AffiliateEntity
}

describe('ForgotAffiliatePasswordUseCase', () => {
  it('неизвестный адрес отвечает ровно так же, как известный', async () => {
    const h = makeHarness({ affiliate: null })
    const uc = new ForgotAffiliatePasswordUseCase(h.affiliates, h.emailQueue)

    expect(await uc.execute(KNOWN)).toEqual({ message: 'If email exists, you will receive a link' })
    expect(h.calls.setToken).toHaveLength(0)
    expect(h.calls.sent).toHaveLength(0)
  })

  it('приостановленному партнёру письмо не уходит, ответ — тот же', async () => {
    const h = makeHarness({ affiliate: entity({ status: 'suspended' as AffiliateEntity['status'] }) })
    const uc = new ForgotAffiliatePasswordUseCase(h.affiliates, h.emailQueue)

    const res = await uc.execute(KNOWN)
    expect(res.message).toBe('If email exists, you will receive a link')
    expect(h.calls.sent).toHaveLength(0)
  })

  it('активному: токен на час, письмо на почту партнёра, ссылка ведёт в партнёрский сброс', async () => {
    const before = Date.now()
    const h = makeHarness({ affiliate: entity() })
    const uc = new ForgotAffiliatePasswordUseCase(h.affiliates, h.emailQueue)

    await uc.execute(`  ${KNOWN.toUpperCase()}  `)

    expect(h.calls.setToken).toHaveLength(1)
    const issued = h.calls.setToken[0]!
    expect(issued.id).toBe('a-1')
    expect(issued.token).toMatch(/^[0-9a-f]{128}$/)
    const ttlMinutes = (issued.expiresAt.getTime() - before) / 60_000
    expect(ttlMinutes).toBeGreaterThanOrEqual(AFFILIATE_RESET_TTL_MS / 60_000 - 1)
    expect(ttlMinutes).toBeLessThanOrEqual(AFFILIATE_RESET_TTL_MS / 60_000 + 1)

    expect(h.calls.sent).toHaveLength(1)
    expect(h.calls.sent[0]!.to).toBe(KNOWN)
    expect(h.calls.sent[0]!.text).toContain('/affiliate/reset-password?token=')
  })
})

describe('ResetAffiliatePasswordUseCase', () => {
  it('неизвестного токена нет — та же ошибка, что и у сожжённой ссылки', async () => {
    const h = makeHarness({ resetRecord: null })
    const uc = new ResetAffiliatePasswordUseCase(h.affiliates)

    await expect(uc.execute('f'.repeat(128), 'NewPass123')).rejects.toThrow(
      AffiliateResetTokenInvalidError,
    )
    expect(h.calls.hashed).toHaveLength(0)
  })

  it('просроченный токен снимается с партнёра и не пишет хеш', async () => {
    const h = makeHarness({
      resetRecord: { affiliateId: 'a-1', tokenExpiresAt: new Date(Date.now() - 1000) },
    })
    const uc = new ResetAffiliatePasswordUseCase(h.affiliates)

    await expect(uc.execute('f'.repeat(128), 'NewPass123')).rejects.toThrow(
      AffiliateResetTokenExpiredError,
    )
    expect(h.calls.cleared).toEqual(['a-1'])
    expect(h.calls.hashed).toHaveLength(0)
  })

  it('успешный сброс: новый хеш записан, токен снят — ссылка одноразовая', async () => {
    const h = makeHarness({
      resetRecord: { affiliateId: 'a-1', tokenExpiresAt: new Date(Date.now() + 60_000) },
    })
    const uc = new ResetAffiliatePasswordUseCase(h.affiliates)

    await expect(uc.execute('f'.repeat(128), 'NewPass123')).resolves.toEqual({ ok: true })
    expect(h.calls.hashed).toHaveLength(1)
    expect(await argon2.verify(h.calls.hashed[0]!.hash, 'NewPass123')).toBe(true)
    expect(h.calls.cleared).toEqual(['a-1'])
  })

  it('короткий пароль отсекается до любого обращения к репозиторию', async () => {
    const spy = vi.fn()
    const h = makeHarness({ resetRecord: { affiliateId: 'a-1', tokenExpiresAt: null } })
    h.affiliates.findByResetToken = spy
    const uc = new ResetAffiliatePasswordUseCase(h.affiliates)

    await expect(uc.execute('f'.repeat(128), 'short')).rejects.toThrow(/at least 8/)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('ChangeAffiliatePasswordUseCase', () => {
  it('без верного текущего пароль не меняется', async () => {
    const current = await argon2.hash('OldPass123', { type: argon2.argon2id })
    const h = makeHarness({ affiliate: entity({ passwordHash: current }) })
    const uc = new ChangeAffiliatePasswordUseCase(h.affiliates)

    await expect(
      uc.execute('a-1', { currentPassword: 'wrong', newPassword: 'NewPass123' }),
    ).rejects.toThrow(AffiliatePasswordInvalidCurrentError)
    expect(h.calls.hashed).toHaveLength(0)
  })

  it('верный текущий: хеш заменён, незавершённая ссылка восстановления снята', async () => {
    const current = await argon2.hash('OldPass123', { type: argon2.argon2id })
    const h = makeHarness({ affiliate: entity({ passwordHash: current }) })
    const uc = new ChangeAffiliatePasswordUseCase(h.affiliates)

    await expect(
      uc.execute('a-1', { currentPassword: 'OldPass123', newPassword: 'NewPass123' }),
    ).resolves.toEqual({ ok: true })
    expect(await argon2.verify(h.calls.hashed[0]!.hash, 'NewPass123')).toBe(true)
    expect(h.calls.cleared).toEqual(['a-1'])
  })
})
