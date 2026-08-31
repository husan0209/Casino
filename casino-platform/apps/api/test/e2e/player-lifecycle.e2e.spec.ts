/**
 * E2E player lifecycle (GAP-05, Engineering Excellence Plan §2.1).
 *
 * Против РЕАЛЬНОГО запущенного сервера: CI собирает api (`pnpm build`) и
 * стартует `node dist/main.js` в фоне (prod-путь целиком: helmet, pino,
 * rawBody-capture), тестовый Postgres/Redis — сервисы job'а.
 * Спек — только HTTP-клиент (голый fetch), без подъёма Nest в воркере:
 * NestFactory внутри vitest-форка крашит процесс (native crash, см. CI).
 *
 * Сценарий: register → login → KYC (submit+upload+approve) → депозит через
 * вебхук Rukassa с валидным HMAC → баланс → launch → provider-callback
 * Bet/Win → вывод (lock) → одобрение админом (confirmWithdrawal).
 *
 * Запуск: E2E_API=1 (CI-шаг после unit; локально скипается).
 * ВАЖНО: describe-колбэк не async, весь код — в beforeAll/it.
 */
import { randomUUID, createHmac } from 'crypto'

import { prisma } from '@casino/database'

const E2E = process.env['E2E_API'] === '1'
const dE2E = E2E ? describe : describe.skip

const BASE = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3001'

const PLAYER_EMAIL = `e2e-player-${randomUUID().slice(0, 8)}@casino.test`
const PLAYER_PASSWORD = 'e2e-PlayerPass1'
const SUPERADMIN_EMAIL = 'e2e-superadmin@casino.test'
const SUPERADMIN_PASSWORD = 'e2e-SuperPass1'
const RUKASSA_SECRET = process.env['RUKASSA_SECRET_KEY'] ?? 'e2e-rukassa-hmac-secret'
const RUKASSA_SHOP_ID = process.env['RUKASSA_SHOP_ID'] ?? 'e2e-shop'

dE2E('E2E: полный жизненный цикл игрока (GAP-05)', () => {
  let playerToken = ''
  let playerUserId = ''
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
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers, body })
    const text = await res.text()
    let json: Record<string, unknown> | null = null
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      json = { raw: text }
    }
    // Глобальный ResponseFormatInterceptor оборачивает ответы контроллеров в
    // { success, data } — разворачиваем. NB: provider-callback использует @Res()
    // и идёт мимо интерсептора (у него success/balance на верхнем уровне — не трогаем).
    if (
      json &&
      typeof json === 'object' &&
      'success' in json &&
      'data' in json &&
      json['data'] !== null &&
      typeof json['data'] === 'object'
    ) {
      json = json['data'] as Record<string, unknown>
    }
    return { status: res.status, json }
  }

  /** Формула rukassa.client.ts: HMAC-SHA256(`${shopId}:${orderId}:${amount}`) по RAW-байтам. */
  function rukassaSign(raw: string): string {
    const parsed = JSON.parse(raw) as { order_id: string; amount: string }
    const payload = `${RUKASSA_SHOP_ID}:${parsed.order_id}:${parsed.amount}`
    return createHmac('sha256', RUKASSA_SECRET).update(payload).digest('hex')
  }

  beforeAll(async () => {
    // ready-проба: сервер уже должен быть поднят CI-шагом (или оператором локально)
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${BASE}/api/v1/health/ready`)
        if (res.ok) {
          break
        }
      } catch {
        // ещё не поднялся
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    // фикс-старт: demo-provider (slug фабрики адаптеров) + игра + суперадмин
    const provider = await prisma.gameProvider.upsert({
      where: { slug: 'demo-provider' },
      update: {},
      create: { slug: 'demo-provider', name: 'Demo Provider', type: 'slots' },
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
    const argon2 = await import('argon2')
    await prisma.adminUser.upsert({
      where: { email: SUPERADMIN_EMAIL },
      update: { passwordHash: await argon2.hash(SUPERADMIN_PASSWORD, { type: 2 }) },
      create: {
        email: SUPERADMIN_EMAIL,
        passwordHash: await argon2.hash(SUPERADMIN_PASSWORD, { type: 2 }),
        role: 'superadmin',
        isActive: true,
      },
    })
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
    await prisma.$disconnect()
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

    // минимальный валидный PNG: сигнатура (сниффер проверяет магию).
    // document_type -> KycFileType (front/back/selfie/proof_of_address) —
    // так же шлёт и веб-фронт (apps/web/src/app/kyc/page.tsx)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const upload = await api('POST', '/kyc/documents', {
      token: playerToken,
      multipart: { fields: { document_type: 'front' }, file: { name: 'file', bytes: png } },
    })
    expect(upload.status).toBe(201)
    expect(upload.json?.['ok']).toBe(true)
  })

  it('4. KYC approve суперадмином (admin-JWT; reviewedBy -> AdminUser FK)', async () => {
    const login = await api('POST', '/admin/auth/login', {
      body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
    })
    expect(login.status).toBe(201)
    const approve = await api('POST', `/admin/kyc/${kycProfileId}/approve`, {
      token: login.json?.['accessToken'] as string,
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
        idempotencyKey: `e2e-dep-${depositPrId}`,
      },
    })
    const raw = JSON.stringify({ order_id: depositPrId, amount: '1000', status: 'success' })
    const res = await api('POST', '/payments/webhooks/rukassa', {
      raw: { text: raw, sign: rukassaSign(raw) },
    })
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

    const bet = await api('POST', '/provider-callback/demo-provider/bet', {
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

    const win = await api('POST', '/provider-callback/demo-provider/win', {
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
    const approve = await api('POST', `/admin/withdrawals/${withdrawalPrId}/approve`, {
      token: login.json?.['accessToken'] as string,
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
      select: { type: true },
    })
    const types = ledger.map((l) => l.type).sort()
    expect(types).toEqual(['BET', 'DEPOSIT', 'WIN', 'WITHDRAWAL_CONFIRM'])
  })
})
