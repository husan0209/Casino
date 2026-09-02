import { describe, expect, it } from 'vitest'

import { assertSeedAdminConfig } from '../../../packages/database/src/seed-guard'

/**
 * GAP-38: seed fail-closed. Guard — чистая функция без зависимостей
 * (argon2/prisma только в seed.ts), тестируется напрямую.
 */

const PROD = { NODE_ENV: 'production' }

describe('seed-guard fail-closed (GAP-38)', () => {
  it('production без SEED_* → отказ с подсказкой про DEPLOY.md', () => {
    const r = assertSeedAdminConfig(PROD)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toContain('обязательны SEED_ADMIN_EMAIL')
      expect(r.message).toContain('DEPLOY.md')
    }
  })

  it('production с дефолтным dev-паролем → отказ', () => {
    const r = assertSeedAdminConfig({
      ...PROD,
      SEED_ADMIN_EMAIL: 'admin@example.com',
      SEED_ADMIN_PASSWORD: 'dev_superadmin_password_123',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toContain('дефолтным dev-паролем')
    }
  })

  it('production с валидными SEED_* → ok', () => {
    const r = assertSeedAdminConfig({
      ...PROD,
      SEED_ADMIN_EMAIL: 'admin@example.com',
      SEED_ADMIN_PASSWORD: 'correct-horse-battery-9',
    })
    expect(r).toEqual({ ok: true })
  })

  it('dev (NODE_ENV=development) с дефолтами → ok (guard не мешает локальной разработке)', () => {
    expect(assertSeedAdminConfig({ NODE_ENV: 'development' })).toEqual({ ok: true })
    expect(assertSeedAdminConfig({})).toEqual({ ok: true })
  })

  it('NODE_ENV=test с дефолтами → ok (CI без production-семантики)', () => {
    expect(assertSeedAdminConfig({ NODE_ENV: 'test' })).toEqual({ ok: true })
  })
})
