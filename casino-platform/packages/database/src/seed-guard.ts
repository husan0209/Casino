/**
 * GAP-38: fail-closed guard для seed админа.
 * Чистый модуль без зависимостей (argon2/prisma импортируются только в seed.ts),
 * чтобы защиту можно было тестировать без native-модулей.
 */

const DEFAULT_SEED_PASSWORD = 'dev_superadmin_password_123'

export type SeedGuardResult = { ok: true } | { ok: false; message: string }

export function assertSeedAdminConfig(env: NodeJS.ProcessEnv): SeedGuardResult {
  if (env['NODE_ENV'] !== 'production') {
    return { ok: true }
  }
  if (!env['SEED_ADMIN_EMAIL'] || !env['SEED_ADMIN_PASSWORD']) {
    return {
      ok: false,
      message:
        'SEED: отказ — в NODE_ENV=production обязательны SEED_ADMIN_EMAIL и SEED_ADMIN_PASSWORD (см. docs/DEPLOY.md)',
    }
  }
  if (env['SEED_ADMIN_PASSWORD'] === DEFAULT_SEED_PASSWORD) {
    return {
      ok: false,
      message:
        'SEED: отказ — SEED_ADMIN_PASSWORD совпадает с дефолтным dev-паролем (см. docs/DEPLOY.md)',
    }
  }
  return { ok: true }
}
