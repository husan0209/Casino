/**
 * E2E player lifecycle (GAP-05, Engineering Excellence Plan §2.1).
 *
 * Реальный NestJS-сервер (AppModule целиком, express + json-rawBody capture)
 * на эфемерном порту, реальный Postgres (DATABASE_URL из окружения CI).
 * Клиентский слой — обычный fetch, без новых зависимостей.
 *
 * Сценарий ТЗ: register → login → KYC (submit + upload + approve) →
 * депозит через вебхук Rukassa с валидным HMAC → баланс →
 * launch игры → provider-callback Bet/Win → заявка на вывод (lock) →
 * одобрение админом (confirmWithdrawal).
 *
 * Запуск: E2E_API=1 (в CI отдельный шаг; локально скипается).
 * ВАЖНО: describe-колбэк не async, весь код — в beforeAll/it.
 */
import { randomUUID, createHmac } from 'crypto'

import { prisma } from '@casino/database'

const E2E = process.env['E2E_API'] === '1'
const dE2E = E2E ? describe : describe.skip

// ── env до загрузки AppModule (ConfigModule.forRoot валидирует при import) ──
process.env['NODE_ENV'] = 'test'
process.env['JWT_ACCESS_SECRET'] =
  'e2e-access-secret-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env['JWT_REFRESH_SECRET'] =
  'e2e-refresh-secret-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env['APP_URL'] = 'http://localhost:3000'
process.env['ADMIN_URL'] = 'http://localhost:3002'
process.env['DOMAIN'] = 'localhost'
process.env['CORS_ORIGINS'] = 'http://localhost:3000'
process.env['REDIS_URL'] = process.env['REDIS_URL'] || 'redis://localhost:6379/1'
process.env['RUKASSA_SHOP_ID'] = 'e2e-shop'
process.env['RUKASSA_SECRET_KEY'] = 'e2e-rukassa-hmac-secret'
process.env['RUKASSA_API_BASE'] = 'http://localhost:9' // web-вызовы не будут совершены
process.env['NOWPAYMENTS_IPN_SECRET'] = 'e2e-nowpayments-ipn-secret'

const PLAYER_EMAIL = 'e2e-player@casino.test'
const PLAYER_PASSWORD = 'e2e-PlayerPass1'
const ADMIN_EMAIL = 'e2e-admin@casino.test'
const ADMIN_PASSWORD = 'e2e-AdminPass1'
const SUPERADMIN_EMAIL = 'e2e-superadmin@casino.test'
const SUPERADMIN_PASSWORD = 'e2e-SuperPass1'

dE2E('E2E: полный жизненный цикл игрока (GAP-05)', () => {
  let baseUrl = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nest app без импорта типов на верхнем уровне
  let app: any
  let playerToken = ''
  let playerUserId = ''
  let adminUserToken = ''
  let adminUserId = ''
  let kycProfileId = ''
  let depositPrId = ''
  let withdrawalPrId = ''
  let providerId = ''
  let gameId = ''
  const userIds: string[] = []

  async function api(
    method: 'GET' | 'POST',
    path: string,
    opts: {
      token?: string
      body?: unknown
      raw?: { text: string; sign?: string }
      multipart?: { fields: Record<string, string>; file?: { name: string; bytes: Buffer } }
    } = {},
  ): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const headers: Record<string, string> = {}
    if (opts.token) {
      headers['authorization'] = `Bearer ${opts.token}`
    }
    let body: BodyInit | undefined
    if (opts.multipart) {
      const form = new FormData()
      for (const [k, v] of Object.entries(opts.multipart.fields)) {
        form.append(k, v)
      }
      if (opts.multipart.file) {
        // PNG magic bytes: content-type не участвует в решениях — сниффер смотрит байты
        form.append(
          opts.multipart.file.name,
          new Blob([new Uint8Array(opts.multipart.file.bytes)], { type: 'image/png' }),
          'document.png',
        )
      }
      body = form
    } else if (opts.raw) {
      headers['content-type'] = 'application/json'
      if (opts.raw.sign) {
        headers['x-signature'] = opts.raw.sign
      }
      body = opts.raw.text
    } else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const res = await fetch(`${baseUrl}/api/v1${path}`, { method, headers, body })
    const text = await res.text()
    let json: Record<string, unknown> | null = null
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      json = { raw: text }
    }
    return { status: res.status, json }
  }

  function rukassaSign(raw: string): string {
    // формула rukassa.client.ts: HMAC-SHA256(`${shopId}:${orderId}:${amount}`)
    const parsed = JSON.parse(raw) as { order_id: string; amount: string }
    const payload = `${process.env['RUKASSA_SHOP_ID']}:${parsed.order_id}:${parsed.amount}`
    return createHmac('sha256', process.env['RUKASSA_SECRET_KEY']!).update(payload).digest('hex')
  }

  beforeAll(async () => {
    const { NestFactory } = await import('@nestjs/core')
    const { AppModule } = await import('../../src/app.module')
    const { json, urlencoded } = await import('express')

    // фикс-старт: provider demo + игра + админы
    const provider = await prisma.gameProvider.upsert({
      where: { slug: 'demo' },
      update: {},
      create: { slug: 'demo', name: 'Demo Provider', type: 'slots' },
    })
    providerId = provider.id
    const game = await prisma.game.upsert({
      where: { slug: 'e2e-sweet-fruits' },
      update: {},
      create: {
        providerId,
        externalGameId: 'demo-sweet-fruits',
        slug: 'e2e-sweet-fruits',
        name: 'E2E Sweet Fruits',
        type: 'slot',
        category: 'slots',
        isEnabled: true,
      },
    })
    gameId = game.id

    const { hash } = await import('argon2')
    const superadmin = await prisma.adminUser.upsert({
      where: { email: SUPERADMIN_EMAIL },
      update: { passwordHash: await hash(SUPERADMIN_PASSWORD, { type: 2 }) },
      create: {
        email: SUPERADMIN_EMAIL,
        passwordHash: await hash(SUPERADMIN_PASSWORD, { type: 2 }),
        role: 'superadmin',
        isActive: true,
      },
    })
    expect(superadmin.role).toBe('superadmin')

    app = await NestFactory.create(AppModule, {
      bodyParser: false, // свои парсеры с rawBody capture, как в main.ts
      logger: false,
    })
    app.use(
      json({
        limit: '1mb',
        verify: (req: unknown, _r: unknown, buf: Buffer) => {
          const r = req as { rawBody?: string }
          r.rawBody = buf.toString('utf8')
        },
      }),
    )
    app.use(urlencoded({ extended: true, limit: '1mb' }))
    app.setGlobalPrefix('api/v1')
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`
  })

  afterAll(async () => {
    // порядок: без-cascade таблицы руками, остальное уйдёт каскадом от user
    for (const id of userIds) {
      await prisma.ledgerEntry.deleteMany({ where: { userId: id } })
      await prisma.walletAccount.deleteMany({ where: { userId: id } })
    }
    if (depositPrId) {
      await prisma.paymentCallback.deleteMany({ where: { externalId: depositPrId } })
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }
    if (gameId) {
      await prisma.game.deleteMany({ where: { id: gameId } })
    }
    if (providerId) {
      await prisma.gameProvider.deleteMany({ where: { id: providerId } })
    }
    if (app) {
      await app.close()
    }
  })

  it('1. регистрация игрока возвращает accessToken и referralCode', async () => {
    const res = await api('POST', '/auth/register', {
      body: { email: PLAYER_EMAIL, password: PLAYER_PASSWORD },
    })
    expect(res.status).toBe(201)
    expect(typeof res.json?.['accessToken']).toBe('string')
    expect(res.json?.['user']).toMatchObject({ email: PLAYER_EMAIL, role: 'user' })
    playerToken = res.json?.['accessToken'] as string
    playerUserId = (res.json?.['user'] as { id: string }).id
    userIds.push(playerUserId)
  })

  it('2. login возвращает свежий accessToken', async () => {
    const res = await api('POST', '/auth/login', {
      body: { email: PLAYER_EMAIL, password: PLAYER_PASSWORD },
    })
    expect(res.status).toBe(201)
    expect(typeof res.json?.['accessToken']).toBe('string')
  })

  it('3. KYC: submit + upload PNG-документа (magic bytes)', async () => {
    const submit = await api('POST', '/kyc/submit', {
      token: playerToken,
      body: {
        first_name: 'E2E',
        last_name: 'Player',
        date_of_birth: '1990-05-15',
        country: 'RU',
        document_type: 'passport',
        document_number: '4509123456',
      },
    })
    expect(submit.status).toBe(201)
    const profile = await prisma.kycProfile.findUnique({ where: { userId: playerUserId } })
    expect(profile?.status).toBe('pending')
    kycProfileId = profile!.id

    // минимальный валидный PNG: подпись + IHDR (сниффер проверяет магию)
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
      Buffer.alloc(16), // IHDR length+type placeholder — сниффер смотрит только магию
    ])
    const upload = await api('POST', '/kyc/documents', {
      token: playerToken,
      multipart: { fields: { document_type: 'passport' }, file: { name: 'file', bytes: png } },
    })
    expect(upload.status).toBe(201)
    expect(upload.json?.['ok']).toBe(true)
  })

  it('4. KYC approve админ-юзером (role=admin через RolesGuard)', async () => {
    const reg = await api('POST', '/auth/register', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    expect(reg.status).toBe(201)
    adminUserId = (reg.json?.['user'] as { id: string }).id
    userIds.push(adminUserId)
    await prisma.user.update({ where: { id: adminUserId }, data: { role: 'admin' } })
    const login = await api('POST', '/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    adminUserToken = login.json?.['accessToken'] as string
    const approve = await api('POST', `/admin/kyc/${kycProfileId}/approve`, {
      token: adminUserToken,
    })
    expect(approve.status).toBe(201)
    const profile = await prisma.kycProfile.findUnique({ where: { id: kycProfileId } })
    expect(profile?.status).toBe('approved')
  })

  it('5. депозит: вебхук Rukassa с валидным HMAC зачисляет 1000 RUB', async () => {
    // Платёжка создаётся на стороне провайдера — в E2E фиксируем её в БД напрямую,
    // вебхук — публичный контракт с HMAC по raw body
    depositPrId = randomUUID()
    await prisma.paymentRequest.create({
      data: {
        id: depositPrId,
        userId: playerUserId,
        type: 'deposit',
        status: 'pending',
        provider: 'rukassa',
        method: 'card',
        currency: 'RUB',
        amount: '1000',
      },
    })
    const raw = JSON.stringify({ order_id: depositPrId, amount: '1000', status: 'success' })
    const res = await api('POST', '/payments/webhooks/rukassa', { raw: { text: raw, sign: rukassaSign(raw) } })
    expect(res.status).toBe(200)
    const bal = await api('GET', '/wallet/balances', { token: playerToken })
    const rub = (bal.json as Array<{ currency: string; balance: string; locked: string }>)?.find(
      (b) => b.currency === 'RUB',
    )
    expect(rub?.balance).toBe('1000')
    expect(rub?.locked).toBe('0')
  })

  it('5b. вебхук с неверной подписью НЕ меняет баланс (fail-closed)', async () => {
    const raw = JSON.stringify({ order_id: depositPrId, amount: '999999', status: 'success' })
    const res = await api('POST', '/payments/webhooks/rukassa', {
      raw: { text: raw, sign: 'deadbeef'.repeat(8) },
    })
    expect(res.status).toBe(200)
    const bal = await api('GET', '/wallet/balances', { token: playerToken })
    const rub = (bal.json as Array<{ currency: string; balance: string }>)?.find(
      (b) => b.currency === 'RUB',
    )
    expect(rub?.balance).toBe('1000')
  })

  it('6. launch игры создаёт сессию; Bet 100 и Win 250 через provider-callback', async () => {
    const launch = await api('POST', '/casino/games/e2e-sweet-fruits/launch', {
      token: playerToken,
      body: { currency: 'RUB' },
    })
    expect(launch.status).toBe(201)
    const launchUrl = launch.json?.['launch_url'] as string
    const token = new URL(launchUrl).searchParams.get('token') as string
    expect(token).toBeTruthy()

    const bet = await api('POST', '/provider-callback/demo/bet', {
      body: {
        action: 'bet',
        player_token: token,
        amount: '100',
        transaction_id: 'e2e-bet-1',
        round_id: 'e2e-round-1',
        game_id: 'demo-sweet-fruits',
        currency: 'RUB',
      },
    })
    expect(bet.status).toBe(200)
    expect(bet.json?.['success']).toBe(true)
    expect(bet.json?.['balance']).toBe('900')

    const win = await api('POST', '/provider-callback/demo/win', {
      body: {
        action: 'win',
        player_token: token,
        amount: '250',
        transaction_id: 'e2e-win-1',
        round_id: 'e2e-round-1',
        game_id: 'demo-sweet-fruits',
        currency: 'RUB',
      },
    })
    expect(win.status).toBe(200)
    expect(win.json?.['balance']).toBe('1150')
  })

  it('7. вывод 500 RUB: KYC-gate пройден, средства блокируются (locked)', async () => {
    const res = await api('POST', '/payments/withdrawal/fiat', {
      token: playerToken,
      body: { amount: '500', method: 'card', destination: '4111111111111111' },
    })
    expect(res.status).toBe(201)
    withdrawalPrId = res.json?.['payment_request_id'] as string
    const bal = await api('GET', '/wallet/balances', { token: playerToken })
    const rub = (bal.json as Array<{ currency: string; balance: string; locked: string }>)?.find(
      (b) => b.currency === 'RUB',
    )
    expect(rub?.balance).toBe('1150')
    expect(rub?.locked).toBe('500')
  })

  it('8. одобрение суперадмином: confirmWithdrawal — баланс 650, locked 0', async () => {
    const login = await api('POST', '/admin/auth/login', {
      body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
    })
    expect(login.status).toBe(201)
    expect(login.json?.['accessToken']).toBeTruthy()
    adminApiToken = login.json?.['accessToken'] as string
    const approve = await api('POST', `/admin/withdrawals/${withdrawalPrId}/approve`, {
      token: adminApiToken,
    })
    expect(approve.status).toBe(201)
    const bal = await api('GET', '/wallet/balances', { token: playerToken })
    const rub = (bal.json as Array<{ currency: string; balance: string; locked: string }>)?.find(
      (b) => b.currency === 'RUB',
    )
    expect(rub?.balance).toBe('650')
    expect(rub?.locked).toBe('0')
    // проводки игрока: DEPOSIT 1000 + BET -100 + WIN 250 + WITHDRAWAL_CONFIRM -500
    const ledger = await prisma.ledgerEntry.findMany({
      where: { userId: playerUserId },
      select: { type: true, amount: true },
    })
    const types = ledger.map((l) => l.type).sort()
    expect(types).toEqual(['BET', 'DEPOSIT', 'WIN', 'WITHDRAWAL_CONFIRM'])
  })
})
