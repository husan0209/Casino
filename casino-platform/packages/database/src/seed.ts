import * as argon2 from 'argon2'

import { prisma } from './index'
import { DEMO_GAMES } from './seed-demo-games'
import { assertSeedAdminConfig } from './seed-guard'

/**
 * Вывод в stdout для CLI.
 *
 * Пишем напрямую, а не через `console.log`: здесь stdout — интерфейс команды
 * для оператора, а не production-логирование (AGENTS.md -> Pino), и
 * `no-console` у правил включён. Обход через `process.stdout.write` избавляет
 * от подавления правила на весь файл.
 */
function log(message: string): void {
  process.stdout.write(`${message}\n`)
}

/**
 * GAP-38 fail-closed: в production сид отказывается создавать админа
 * с дефолтным паролем или без обязательных переменных.
 */
function assertSafeToSeed(): void {
  const guard = assertSeedAdminConfig(process.env)
  if (!guard.ok) {
    console.error(guard.message)
    process.exit(1)
  }
}

/** Создаёт суперадмина, если его ещё нет. Идемпотентно по email. */
async function seedAdmin(): Promise<void> {
  const adminEmail = process.env['SEED_ADMIN_EMAIL'] || 'superadmin@casino.example.com'
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'] || 'dev_superadmin_password_123'

  const existing = await prisma.adminUser.findUnique({ where: { email: adminEmail } })
  if (existing) {
    return
  }

  const passwordHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  })
  const admin = await prisma.adminUser.create({
    data: {
      email: adminEmail,
      passwordHash,
      role: 'superadmin',
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
    },
  })
  log(`Seeded admin ${admin.email}`)
}

/** Демо-провайдер + витрина из десяти игр. Идемпотентно по slug. */
async function seedDemoGames(): Promise<void> {
  const demoProvider = await prisma.gameProvider.upsert({
    where: { slug: 'demo-provider' },
    update: {},
    create: {
      slug: 'demo-provider',
      name: 'Demo Provider',
      type: 'slots',
      isEnabled: true,
      sortOrder: 0,
    },
  })

  for (const game of DEMO_GAMES) {
    await prisma.game.upsert({
      where: { slug: game.slug },
      update: {},
      create: {
        providerId: demoProvider.id,
        externalGameId: game.slug,
        slug: game.slug,
        name: game.name,
        nameRu: game.nameRu,
        type: 'slot',
        category: 'slots',
        isEnabled: true,
        isFeatured: true,
        isPopular: true,
        hasDemo: true,
        rtp: game.rtp,
        supportedCurrencies: ['RUB', 'USDT_TRC20'],
      },
    })
  }

  await prisma.gameProvider.update({
    where: { id: demoProvider.id },
    data: { gameCount: DEMO_GAMES.length },
  })
  log('Seeded demo games')
}

type SettingSeed = {
  key: string
  value: string
  type: 'number' | 'boolean' | 'string'
  category: string
}

/**
 * Настройки по умолчанию. Значения — дефолт; админ меняет их в панели,
 * и запись в БД перекрывает то, что пришло из env.
 */
const SETTINGS: readonly SettingSeed[] = [
  { key: 'kyc_deposit_limit_rub', value: '5000', type: 'number', category: 'kyc' },
  { key: 'min_deposit_rub', value: '100', type: 'number', category: 'payments' },
  { key: 'referral_reward_rate', value: '0.05', type: 'number', category: 'referral' },
  { key: 'referral_enabled', value: 'true', type: 'boolean', category: 'referral' },
  // Партнёрская программа (ТЗ ч.8 §6.5). Ключи affiliate_* — обязательный
  // контракт AffiliateSettingsService.
  { key: 'affiliate_enabled', value: 'true', type: 'boolean', category: 'affiliate' },
  {
    key: 'affiliate_default_revshare_rate',
    value: '0.2000',
    type: 'number',
    category: 'affiliate',
  },
  { key: 'affiliate_cookie_days', value: '30', type: 'number', category: 'affiliate' },
  { key: 'affiliate_min_deposit', value: '0', type: 'number', category: 'affiliate' },
  { key: 'affiliate_require_kyc', value: 'true', type: 'boolean', category: 'affiliate' },
  // Выключен по умолчанию: отрицательный перенос защищает партнёра, но
  // оператору выгоднее перенос (ТЗ ч.8 §3.2, решение D8).
  { key: 'affiliate_negative_carryover', value: 'false', type: 'boolean', category: 'affiliate' },
  {
    key: 'affiliate_attribution_model',
    value: 'last_click',
    type: 'string',
    category: 'affiliate',
  },
  // 180 дней >= cookie_days (30): иначе антифрод F1 останется без сигнала.
  { key: 'affiliate_click_retention_days', value: '180', type: 'number', category: 'affiliate' },
  { key: 'affiliate_auto_suspend_threshold', value: '20', type: 'number', category: 'affiliate' },
  { key: 'affiliate_terms_version', value: '1.0', type: 'string', category: 'affiliate' },
]

/** Настройки сида. upsert по ключу: значение обновляется, тип/категория — нет. */
async function seedSettings(): Promise<void> {
  for (const setting of SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    })
  }
  log('Seed OK')
}

async function main(): Promise<void> {
  assertSafeToSeed()
  await seedAdmin()
  await seedDemoGames()
  await seedSettings()
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
