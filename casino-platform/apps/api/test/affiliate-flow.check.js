/*
 * Автономный Node-скрипт проверки: CommonJS и без типов, поэтому правила
 * модулей приложения к нему неприменимы — require() и console здесь норма,
 * а type-aware правила видят только any.
 */
/* eslint-disable no-console, max-lines-per-function, max-depth, max-params, @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition */
/**
 * Функциональная проверка финансового ядра партнёрской программы на РЕАЛЬНОЙ БД.
 *
 * ЗАЧЕМ НЕ МОКИ. Моки не воспроизводят главный источник ошибок в этой
 * подсистеме: Prisma Decimal, реальные уникальные индексы и транзакции. Уже
 * было поймано два бага, которые моки пропустили:
 *   - groupBy по ledger_entries.currency (такого поля нет, валюта в
 *     wallet_accounts) — был бы runtime-ошибкой;
 *   - money.add возвращает нормализованную строку, а не 8 знаков — ломался
 *     формат начислений.
 *
 * Сценарий: регистрация партнёра → клик → атрибуция → игра → суточный расчёт
 * → начисление на кошелёк → идемпотентность повторного расчёта → clawback.
 *
 * Запуск:
 *   pnpm --filter @casino/api build
 *   node apps/api/test/affiliate-flow.check.js
 *
 * Требует поднятой dev-БД и ПРИМЕНЁННЫХ миграций. Данные не удаляются —
 * помечаются префиксом itest-<timestamp>; cleanup выполняет
 * `node apps/api/test/affiliate-flow.check.js --cleanup`.
 */
const { NestFactory } = require('@nestjs/core')

const RUN_TAG = process.env['AFFILIATE_FLOW_TAG'] ?? `itest-${Date.now()}`
const CLEANUP = process.argv.includes('--cleanup')

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`)
  }
}

function setEnv() {
  process.env['NODE_ENV'] = 'test'
  process.env['AFFILIATE_JWT_SECRET'] = process.env['AFFILIATE_JWT_SECRET'] || 'x'.repeat(64)
  process.env['DATABASE_URL'] =
    process.env['DATABASE_URL'] || 'postgresql://postgres:postgres@localhost:55432/casino_dev'
  process.env['JWT_ACCESS_SECRET'] = process.env['JWT_ACCESS_SECRET'] || 'a'.repeat(64)
  process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] || 'b'.repeat(64)
  process.env['APP_URL'] = process.env['APP_URL'] || 'http://localhost:3000'
  process.env['ADMIN_URL'] = process.env['ADMIN_URL'] || 'http://localhost:3002'
  process.env['DOMAIN'] = process.env['DOMAIN'] || 'localhost'
  delete process.env['REDIS_URL']
}

/**
 * Удаляет данные одного прогона. RUN_TAG можно передать через
 * AFFILIATE_FLOW_TAG, чтобы вычистить старый прогон; значение ALL удаляет все
 * прогоны с префиксом itest- (для очистки dev-БД).
 */
async function cleanup(prisma) {
  const prefix = RUN_TAG === 'ALL' ? 'itest-' : RUN_TAG
  // Игроки регистрируются как `${RUN_TAG}-player@…`. Нормализуем разделитель,
  // иначе при префиксе, уже оканчивающемся на «-», получилось бы «itest--».
  const playerPrefix = prefix.endsWith('-') ? prefix : `${prefix}-`
  const affiliates = await prisma.affiliate.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true, userId: true },
  })
  const partnerIds = affiliates.map((affiliate) => affiliate.id)
  const partnerUserIds = affiliates.map((affiliate) => affiliate.userId).filter((id) => id !== null)

  // Порядок важен: сначала зависимые строки, затем родителей (FK).
  const attributions = await prisma.affiliateAttribution.deleteMany({
    where: { player: { email: { startsWith: playerPrefix } } },
  })
  const commissions = await prisma.affiliateCommission.deleteMany({
    where: { affiliateId: { in: partnerIds } },
  })
  const clicks = await prisma.affiliateClick.deleteMany({
    where: { affiliateId: { in: partnerIds } },
  })
  const transactions = await prisma.gameTransaction.deleteMany({
    where: { externalTransactionId: { startsWith: prefix } },
  })
  const rounds = await prisma.gameRound.deleteMany({
    where: { externalRoundId: { startsWith: prefix } },
  })
  const sessions = await prisma.gameSession.deleteMany({
    where: { sessionToken: { startsWith: prefix } },
  })
  const ledgers = await prisma.ledgerEntry.deleteMany({ where: { userId: { in: partnerUserIds } } })
  const partnerWallets = await prisma.walletAccount.deleteMany({
    where: { userId: { in: partnerUserIds } },
  })
  const playerWallets = await prisma.walletAccount.deleteMany({
    where: { user: { email: { startsWith: playerPrefix } } },
  })
  const players = await prisma.user.deleteMany({ where: { email: { startsWith: playerPrefix } } })
  const partners = await prisma.affiliate.deleteMany({ where: { email: { startsWith: prefix } } })
  const partnerUsers = await prisma.user.deleteMany({ where: { id: { in: partnerUserIds } } })

  console.log(
    `cleanup [${prefix}]: партнёров=${partners.count} игроков=${players.count} ` +
      `начислений=${commissions.count} атрибуций=${attributions.count} кликов=${clicks.count} ` +
      `транзакций=${transactions.count} раундов=${rounds.count} сессий=${sessions.count} ` +
      `ledger=${ledgers.count} кошельков=${partnerWallets.count + playerWallets.count} ` +
      `user-партнёров=${partnerUsers.count}`,
  )
}

async function main() {
  setEnv()
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()

  if (CLEANUP) {
    await cleanup(prisma)
    await prisma.$disconnect()
    return
  }

  const { AppModule } = require('../dist/app.module')
  const { AffiliateFacade } = require('../dist/modules/affiliate/facade/affiliate.facade')
  const {
    AttributePlayerUseCase,
  } = require('../dist/modules/affiliate/application/use-cases/attribute-player.use-case')
  const {
    CreateCommissionUseCase,
  } = require('../dist/modules/affiliate/application/use-cases/create-commission.use-case')
  const {
    CreditCommissionUseCase,
  } = require('../dist/modules/affiliate/application/use-cases/credit-commission.use-case')
  const {
    TrackClickUseCase,
  } = require('../dist/modules/affiliate/application/use-cases/track-click.use-case')
  const {
    ClawbackPlayerCommissionsUseCase,
  } = require('../dist/modules/affiliate/application/use-cases/clawback-player-commissions.use-case')
  const {
    RegisterAffiliateUseCase,
  } = require('../dist/modules/affiliate/application/use-cases/register-affiliate.use-case')

  // ВАЖНО: preview:true НЕ подходит — в этом режиме Nest не вызывает
  // конструкторы провайдеров, и app.get() отдаёт «пустые» экземпляры
  // (все инъектированные поля undefined). Поэтому поднимаем приложение
  // полноценно через app.init(): так проверяется РЕАЛЬНАЯ сборка графа DI.
  const app = await NestFactory.create(AppModule, { logger: false })
  await app.init()
  const facade = app.get(AffiliateFacade, { strict: false })
  const attributePlayer = app.get(AttributePlayerUseCase, { strict: false })
  const createCommission = app.get(CreateCommissionUseCase, { strict: false })
  const creditCommission = app.get(CreditCommissionUseCase, { strict: false })
  const trackClick = app.get(TrackClickUseCase, { strict: false })
  const clawback = app.get(ClawbackPlayerCommissionsUseCase, { strict: false })
  const registerAffiliate = app.get(RegisterAffiliateUseCase, { strict: false })

  const steps = []
  const log = (name, detail) => {
    steps.push(name)
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
  }

  // ── 1. Регистрация партнёра: ставка приходит из system_settings ───────────
  const email = `${RUN_TAG}@example.com`
  const registered = await registerAffiliate.execute({
    email,
    password: 'SuperSecret123',
    acceptTerms: true,
  })
  const affiliateId = registered.affiliateId
  assert(typeof affiliateId === 'string', 'получен affiliateId')
  assert(Number(registered.revshareRate) > 0, 'ставка > 0 (взята из настроек программы)')
  assert(
    registered.trackingUrl.includes(`/go/${registered.trackingCode}`),
    'ссылка ведёт на /go/<code>',
  )
  log('регистрация партнёра', `rate=${registered.revshareRate} code=${registered.trackingCode}`)

  const partnerRow = await prisma.affiliate.findUnique({ where: { id: affiliateId } })
  assert(partnerRow !== null, 'запись affiliates создана')
  // Ставка = дефолт программы (0.2), потому что индивидуальная не задавалась
  assert(
    partnerRow.revshareRate.toFixed(4) === '0.2000',
    `ставка из настроек, получено ${partnerRow.revshareRate.toFixed(4)}`,
  )

  // Повторная регистрация того же email → ошибка, а не дубль
  let duplicateRejected = false
  try {
    await registerAffiliate.execute({ email, password: 'SuperSecret123', acceptTerms: true })
  } catch (err) {
    duplicateRejected = err?.code === 'AFFILIATE_ALREADY_EXISTS'
  }
  assert(duplicateRejected, 'повторная регистрация email отклонена с AFFILIATE_ALREADY_EXISTS')
  log('идемпотентность регистрации', 'дубль email → AFFILIATE_ALREADY_EXISTS')

  // ── 2. Трекинг-ссылка ─────────────────────────────────────────────────────
  const goodClick = await trackClick.execute({
    trackingCode: registered.trackingCode,
    path: '/casino',
  })
  assert(goodClick.shouldSetCookie === true, 'cookie ставится активному партнёру')
  assert(
    goodClick.redirectPath === '/casino',
    `редирект на витрину, получено ${goodClick.redirectPath}`,
  )
  log('клик по ссылке', `redirect=${goodClick.redirectPath} cookieDays=${goodClick.cookieDays}`)

  const badClick = await trackClick.execute({ trackingCode: 'ZZZZZZZZ' })
  assert(badClick.shouldSetCookie === false, 'неизвестный код не атрибутируется')
  assert(badClick.redirectPath === '/casino', 'неизвестный код всё равно ведёт на витрину')
  log('неизвестный код', '302 без cookie — пользователь не ломается')

  // Suspend → клик перестаёт атрибутироваться
  await prisma.affiliate.update({ where: { id: affiliateId }, data: { status: 'suspended' } })
  const suspendedClick = await trackClick.execute({ trackingCode: registered.trackingCode })
  assert(suspendedClick.shouldSetCookie === false, 'suspended-партнёр не атрибутируется')
  await prisma.affiliate.update({ where: { id: affiliateId }, data: { status: 'active' } })
  log('suspended-партнёр', 'клик не атрибутируется, начисления за прошлое сохраняются')

  // ── 3. Игрок: регистрация + атрибуция ────────────────────────────────────
  const playerEmail = `${RUN_TAG}-player@example.com`
  const player = await prisma.user.create({
    data: {
      email: playerEmail,
      status: 'active',
      referralCode: `${RUN_TAG}-ref`.slice(0, 32),
    },
  })
  const attribution = await attributePlayer.execute({
    playerId: player.id,
    trackingCode: registered.trackingCode,
    ip: '203.0.113.99',
    userAgent: 'Mozilla/5.0 (player)',
  })
  assert(attribution.attributed === true, `атрибуция создана, reason=${attribution.reason}`)
  assert(attribution.affiliateId === affiliateId, 'атрибуция ведёт на партнёра')
  log('атрибуция игрока', `reason=${attribution.reason}`)

  // Повторная атрибуция того же игрока игнорируется
  const again = await attributePlayer.execute({
    playerId: player.id,
    trackingCode: registered.trackingCode,
    ip: '203.0.113.99',
  })
  assert(again.reason === 'already_attributed', `повтор игнорируется, reason=${again.reason}`)
  log('повторная атрибуция', 'already_attributed — партнёр не перехватывает игрока')

  // ── 4. Игровые данные за вчера: bet 1000, win 400 → GGR 600 ──────────────
  const periodStart = new Date(Date.now() - 86400000)
  periodStart.setUTCHours(0, 0, 0, 0)
  const periodEnd = new Date(periodStart)
  periodEnd.setUTCHours(23, 59, 59, 999)

  const provider = await prisma.gameProvider.findFirst({ select: { id: true } })
  if (provider === null) {
    throw new Error('Нет game_providers — выполните seed')
  }
  const game = await prisma.game.findFirst({
    where: { providerId: provider.id },
    select: { id: true },
  })
  if (game === null) {
    throw new Error('Нет игр — выполните seed')
  }

  const session = await prisma.gameSession.create({
    data: {
      userId: player.id,
      gameId: game.id,
      providerId: provider.id,
      currency: 'RUB',
      status: 'active',
      sessionToken: `${RUN_TAG}-tok`,
    },
  })
  // Unchecked-форма (скалярные FK): Prisma не требует relation-объекты.
  // Поле времени в схеме называется createdAt, а не startedAt.
  const round = await prisma.gameRound.create({
    data: {
      sessionId: session.id,
      userId: player.id,
      gameId: game.id,
      providerId: provider.id,
      externalRoundId: `${RUN_TAG}-round`,
      currency: 'RUB',
      status: 'closed',
      totalBet: '1000',
      totalWin: '400',
      createdAt: periodStart,
    },
  })
  await prisma.gameTransaction.createMany({
    data: [
      {
        roundId: round.id,
        sessionId: session.id,
        userId: player.id,
        providerId: provider.id,
        type: 'bet',
        externalTransactionId: `${RUN_TAG}-bet`,
        amount: '1000',
        currency: 'RUB',
        balanceAfter: '0',
        createdAt: periodStart,
      },
      {
        roundId: round.id,
        sessionId: session.id,
        userId: player.id,
        providerId: provider.id,
        type: 'win',
        externalTransactionId: `${RUN_TAG}-win`,
        amount: '400',
        currency: 'RUB',
        balanceAfter: '600',
        createdAt: periodStart,
      },
    ],
  })
  await prisma.walletAccount.create({ data: { userId: player.id, currency: 'RUB', balance: '0' } })

  const attrRow = await prisma.affiliateAttribution.findUnique({ where: { playerId: player.id } })
  await prisma.affiliateAttribution.update({
    where: { id: attrRow.id },
    data: {
      status: 'qualified',
      qualifiedAt: new Date(),
      firstDepositId: '00000000-0000-0000-0000-000000000000',
      firstDepositAt: new Date(),
      totalDeposit: '500',
      depositCount: 1,
    },
  })
  log('подготовлены данные периода', 'bet=1000 win=400 → GGR=600, атрибуция qualified')

  // ── 5. Расчёт NGR и комиссии ────────────────────────────────────────────
  const outcome = await createCommission.executeForCurrency(
    { affiliateId, playerId: player.id, attributionId: attrRow.id, periodStart, periodEnd },
    'RUB',
  )
  assert(outcome.status === 'created', `начисление создано, status=${outcome.status}`)
  assert(outcome.ngr.ggr === '600.00000000', `GGR=600, получено ${outcome.ngr.ggr}`)
  assert(outcome.ngr.ngr === '600.00000000', `NGR=600 (без бонусов), получено ${outcome.ngr.ngr}`)
  // 20% от 600 = 120
  assert(
    outcome.commissionAmount === '120.00000000',
    `комиссия 120, получено ${outcome.commissionAmount}`,
  )
  log(
    'расчёт NGR',
    `GGR=${outcome.ngr.ggr} NGR=${outcome.ngr.ngr} комиссия=${outcome.commissionAmount}`,
  )

  // ── 6. Идемпотентность: повторный расчёт не создаёт дубль ───────────────
  const secondRun = await createCommission.executeForCurrency(
    { affiliateId, playerId: player.id, attributionId: attrRow.id, periodStart, periodEnd },
    'RUB',
  )
  assert(secondRun.status === 'skipped_duplicate', `повтор пропущен, status=${secondRun.status}`)
  const commissionCount = await prisma.affiliateCommission.count({
    where: { affiliateId, playerId: player.id, periodStart, currency: 'RUB' },
  })
  assert(commissionCount === 1, `начислений ровно 1, получено ${commissionCount}`)
  log('идемпотентность расчёта', 'повторный запуск не создал дубль')

  // ── 7. Начисление на кошелёк партнёра ───────────────────────────────────
  const credited = await creditCommission.execute({ commissionId: outcome.commissionId })
  assert(credited.status === 'credited', `кредит выполнен, status=${credited.status}`)
  const partnerWallet = await prisma.walletAccount.findFirst({
    where: { userId: partnerRow.userId, currency: 'RUB' },
  })
  assert(partnerWallet !== null, 'у партнёра есть кошелёк')
  assert(
    partnerWallet.balance.toFixed(8) === '120.00000000',
    `на кошельке партнёра 120, получено ${partnerWallet.balance.toFixed(8)}`,
  )
  const ledgerEntry = await prisma.ledgerEntry.findFirst({
    where: { userId: partnerRow.userId },
    orderBy: { createdAt: 'desc' },
  })
  assert(ledgerEntry !== null, 'ledger-запись создана')
  assert(
    ledgerEntry.type === 'CONVERSION_CREDIT',
    `тип ledger = CONVERSION_CREDIT, получено ${ledgerEntry.type}`,
  )
  log(
    'начисление на кошелёк',
    `balance=${partnerWallet.balance.toFixed(8)} type=${ledgerEntry.type}`,
  )

  // Повторный кредит не удваивает баланс
  await creditCommission.execute({ commissionId: outcome.commissionId })
  const afterDouble = await prisma.walletAccount.findFirst({
    where: { userId: partnerRow.userId, currency: 'RUB' },
  })
  assert(
    afterDouble.balance.toFixed(8) === '120.00000000',
    `повторный кредит не изменил баланс, получено ${afterDouble.balance.toFixed(8)}`,
  )
  log('идемпотентность кредита', 'повторное начисление отклонено на уровне ledger')

  // ── 8. Clawback при самоисключении ───────────────────────────────────────
  const clawbackResult = await clawback.execute({ playerId: player.id })
  assert(
    clawbackResult.cancelled === 1,
    `начисление отменено, cancelled=${clawbackResult.cancelled}`,
  )
  assert(
    clawbackResult.reversedAmount === '120.00000000',
    `сумма возвращена 120, получено ${clawbackResult.reversedAmount}`,
  )
  assert(
    clawbackResult.insufficientFunds.length === 0,
    'невозвратных сумм нет (средства были на кошельке)',
  )
  const afterClawback = await prisma.walletAccount.findFirst({
    where: { userId: partnerRow.userId, currency: 'RUB' },
  })
  assert(
    afterClawback.balance.toFixed(8) === '0.00000000',
    `баланс партнёра обнулён, получено ${afterClawback.balance.toFixed(8)}`,
  )
  const cancelledRow = await prisma.affiliateCommission.findUnique({
    where: { id: outcome.commissionId },
  })
  assert(cancelledRow.status === 'cancelled', `статус cancelled, получено ${cancelledRow.status}`)
  const attrAfter = await prisma.affiliateAttribution.findUnique({ where: { id: attrRow.id } })
  assert(
    attrAfter.rejectReason === 'self_exclusion',
    `причина self_exclusion, получено ${attrAfter.rejectReason}`,
  )
  log('clawback', `баланс партнёра ${afterClawback.balance.toFixed(8)}, причина=self_exclusion`)

  // ── 9. Facade-контракт доступен снаружи модуля ───────────────────────────
  assert(typeof facade.runDaily === 'function', 'facade.runDaily доступен')
  const runResult = await facade.runDaily(periodStart.toISOString().slice(0, 10))
  assert(
    runResult.date === periodStart.toISOString().slice(0, 10),
    `период разбора ${runResult.date}`,
  )
  log('facade.runDaily', `обработано=${runResult.processed} создано=${runResult.created}`)

  await app.close()
  await prisma.$disconnect()

  console.log(`\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (${steps.length} шагов)`)
  console.log(`Данные теста помечены префиксом "${RUN_TAG}"`)
  console.log(
    `Очистка: AFFILIATE_FLOW_TAG=${RUN_TAG} node apps/api/test/affiliate-flow.check.js --cleanup`,
  )
  // Явный выход: после app.close() остаются хендлы (сокеты пула БД, таймеры
  // планировщика), из-за чего процесс висел после успешного завершения.
  process.exit(0)
}

main().catch((err) => {
  console.error('FLOW CHECK FAILED:', err?.message ? err.message : String(err))
  if (process.env['FLOW_DEBUG'] === '1' && err?.stack) {
    console.error(err.stack.split('\n').slice(0, 15).join('\n'))
  }
  process.exit(1)
})
