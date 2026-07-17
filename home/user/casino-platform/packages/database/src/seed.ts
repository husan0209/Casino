import { prisma } from './index'
import * as argon2 from 'argon2'
import { randomBytes } from 'crypto'

function genReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'superadmin@casino.example.com'
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'dev_superadmin_password_123'

  const existing = await prisma.adminUser.findUnique({ where: { email: adminEmail } })
  if (existing) {
    console.log('Admin already exists:', adminEmail)
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

  console.log('Seeded superadmin:', admin.email)

  // seed demo provider
  const demoProvider = await prisma.gameProvider.upsert({
    where: { slug: 'demo-provider' },
    update: {},
    create: {
      slug: 'demo-provider',
      name: 'Demo Provider',
      type: 'slots',
      isEnabled: true,
      sortOrder: 0,
      gameCount: 0,
    },
  })

  const demoGames = [
    { slug: 'demo-sweet-fruits', name: 'Sweet Fruits', nameRu: 'Сладкие фрукты', rtp: '96.50' },
    { slug: 'demo-lucky-sevens', name: 'Lucky Sevens', nameRu: 'Счастливые семёрки', rtp: '96.00' },
    { slug: 'demo-book-of-demo', name: 'Book of Demo', nameRu: 'Книга демо', rtp: '96.21' },
  ]

  for (const g of demoGames) {
    await prisma.game.upsert({
      where: { slug: g.slug },
      update: {},
      create: {
        providerId: demoProvider.id,
        externalGameId: g.slug,
        slug: g.slug,
        name: g.name,
        nameRu: g.nameRu,
        type: 'slot',
        category: 'slots',
        isEnabled: true,
        isFeatured: true,
        isPopular: true,
        hasDemo: true,
        rtp: g.rtp,
        supportedCurrencies: ['RUB', 'USDT_TRC20', 'BTC'],
        tags: [],
      },
    })
  }

  await prisma.gameProvider.update({
    where: { id: demoProvider.id },
    data: { gameCount: demoGames.length },
  })

  console.log('Seeded demo provider with', demoGames.length, 'games')

  // system settings
  const settings = [
    { key: 'kyc_deposit_limit_rub', value: '5000', type: 'number' as const, category: 'kyc' },
    { key: 'min_deposit_rub', value: '100', type: 'number' as const, category: 'payments' },
    { key: 'max_deposit_rub', value: '500000', type: 'number' as const, category: 'payments' },
    { key: 'min_withdrawal_rub', value: '500', type: 'number' as const, category: 'payments' },
    { key: 'max_withdrawal_rub', value: '200000', type: 'number' as const, category: 'payments' },
    { key: 'referral_reward_rate', value: '0.05', type: 'number' as const, category: 'referral' },
    { key: 'referral_enabled', value: 'true', type: 'boolean' as const, category: 'referral' },
  ]
  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    })
  }
  console.log('Seeded system settings')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
