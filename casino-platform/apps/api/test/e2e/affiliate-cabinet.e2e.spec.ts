/**
 * E2E HTTP-границы кабинета партнёра (шаг 1.3 плана по партнёрке).
 *
 * Зачем отдельная спека, если есть гард G28: G28 ловит один класс — параметр хендлера
 * без декоратора. Здесь проверяется то, что статикой не выводится: связывание guard'а
 * и токена, форма ответа (snake_case-ключи, по которым живёт фронт), валидация query и
 * тела на РЕАЛЬНОМ маршруте, и то, что PATCH действительно записывает значение.
 *
 * Все пункты — не абстракция, а конкретные дефекты, найденные на живом стенде:
 *  - `/affiliate/*` отвечал 500 при валидном токене, потому что Nest передавал
 *    `undefined` вместо актора (#197). UI без ветки `isError` рисовал это как
 *    «Загрузка…», и кабинет выглядел пустым;
 *  - `POST /affiliate/register` отбивался с «примите условия» при поставленной
 *    галочке: схема ждала `acceptTerms`, оба клиента шлют `accept_terms` (#195);
 *  - `PATCH /affiliate/me` и смена ставки в админке отвечали 200 и ничего не
 *    меняли: `display_name` vs `displayName` (#198).
 *
 * Контрактные спеки (`affiliate-cabinet-contract.spec.ts`) этого поймать не могут в
 * принципе: они вызывают методы контроллера напрямую и передают актора аргументом,
 * то есть HTTP-связывание и регистр имён в теле в них не участвуют.
 *
 * Против РЕАЛЬНОГО запущенного сервера (тот же контур, что у
 * player-lifecycle.e2e.spec.ts): CI поднимает `node dist/main.js` в фоне против
 * тестовой БД, NestFactory внутри vitest-воркера крашит процесс.
 *
 * Запуск: E2E_API=1 (CI-шаг «E2E player lifecycle» гоняет весь каталог test/e2e).
 * ВАЖНО: describe-колбэк не async, весь код — в beforeAll/it.
 */
import { randomUUID } from 'crypto'

import { prisma } from '@casino/database'

const E2E = process.env['E2E_API'] === '1'
const dE2E = E2E ? describe : describe.skip

const BASE = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3001'

const PARTNER_EMAIL = `e2e-partner-${randomUUID().slice(0, 8)}@casino.test`
const PARTNER_PASSWORD = 'e2e-PartnerPass1'

/** Ответы читаются скобками: `noUncheckedIndexedAccess` не даёт взять поле наугад. */
type Json = Record<string, unknown>

function asJson(value: unknown): Json {
  return typeof value === 'object' && value !== null ? (value as Json) : {}
}

dE2E('E2E: HTTP-граница кабинета партнёра', () => {
  let token = ''
  let affiliateId = ''
  let partnerUserId = ''
  let trackingCode = ''

  async function api(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    opts: { token?: string; body?: unknown; query?: string } = {},
  ): Promise<{ status: number; json: Json | null; error: Json | null }> {
    const headers: Record<string, string> = {}
    if (opts.token) {
      headers['authorization'] = `Bearer ${opts.token}`
    }
    let body: string | null = null
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const url = `${BASE}/api/v1${path}${opts.query ?? ''}`
    const res = await fetch(url, { method, headers, body })
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    const envelope = asJson(parsed)
    // ResponseFormatInterceptor оборачивает успех в { success, data }, ошибку — в
    // { success: false, error: { code, message } }. Разворачиваем только успех,
    // иначе ассерты на форму ответа превращаются в ассерты на обёртку.
    const isError = envelope['success'] === false
    return {
      status: res.status,
      json: isError ? null : asJson(envelope['data']),
      error: isError ? asJson(envelope['error']) : null,
    }
  }

  beforeAll(async () => {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${BASE}/api/v1/health/ready`)
        if (res.ok) {
          break
        }
      } catch {
        // сервер CI ещё поднимается
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  })

  afterAll(async () => {
    // affiliate → user каскадом не уходит (связь в другую сторону: партнёр владеет
    // служебной user-записью), поэтому порядок: сначала партнёр, затем пользователь.
    if (affiliateId) {
      await prisma.affiliateAttribution.deleteMany({ where: { affiliateId } })
      await prisma.affiliateClick.deleteMany({ where: { affiliateId } })
      await prisma.affiliateCommission.deleteMany({ where: { affiliateId } })
      await prisma.affiliate.deleteMany({ where: { id: affiliateId } })
    }
    if (partnerUserId) {
      await prisma.ledgerEntry.deleteMany({ where: { userId: partnerUserId } })
      await prisma.walletAccount.deleteMany({ where: { userId: partnerUserId } })
      await prisma.user.deleteMany({ where: { id: partnerUserId } })
    }
    await prisma.$disconnect()
  })

  it('1. без токена кабинет отвечает 401, а не 500', async () => {
    // Именно этот пункт на стенде давал 500: Nest передавал актору undefined,
    // и первая строка хендлера падала TypeError'ом до любой проверки токена.
    for (const path of ['/affiliate/me', '/affiliate/dashboard', '/affiliate/links']) {
      const res = await api('GET', path)
      expect(res.status, path).toBe(401)
      expect(res.error?.['code'], path).toBe('AFFILIATE_UNAUTHORIZED')
    }
  })

  it('2. регистрация принимает snake_case тело (accept_terms)', async () => {
    const res = await api('POST', '/affiliate/register', {
      body: {
        email: PARTNER_EMAIL,
        password: PARTNER_PASSWORD,
        accept_terms: true,
        display_name: 'E2E партнёр',
      },
    })
    expect(res.status).toBe(201)
    const data = res.json ?? {}
    expect(typeof data['access_token']).toBe('string')
    expect(typeof data['affiliate_id']).toBe('string')
    expect(typeof data['tracking_code']).toBe('string')
    expect(data['tracking_url']).toContain(`/go/${String(data['tracking_code'])}`)
    token = data['access_token'] as string
    affiliateId = data['affiliate_id'] as string
    trackingCode = data['tracking_code'] as string

    const row = await prisma.affiliate.findUnique({ where: { id: affiliateId } })
    expect(row?.email).toBe(PARTNER_EMAIL)
    // display_name обязан дойти до записи: поле опциональное, поэтому раньше
    // такой PATCH молча ничего не менял (#198).
    expect(row?.displayName).toBe('E2E партнёр')
    partnerUserId = row?.userId ?? ''
  })

  it('3. повторная регистрация того же email — 409, а не дубль', async () => {
    const res = await api('POST', '/affiliate/register', {
      body: { email: PARTNER_EMAIL, password: PARTNER_PASSWORD, accept_terms: true },
    })
    expect(res.status).toBe(409)
    expect(res.error?.['code']).toBe('AFFILIATE_ALREADY_EXISTS')
  })

  it('4. GET /me отдаёт snake_case-контракт, на который опирается фронт', async () => {
    const res = await api('GET', '/affiliate/me', { token })
    expect(res.status).toBe(200)
    const data = res.json ?? {}
    // Ключи — контракт с apps/web (stores/affiliate.ts): переименование на стороне
    // API роняет кабинет не ошибкой, а пустыми полями.
    expect(data['tracking_code']).toBe(trackingCode)
    expect(typeof data['revshare_rate']).toBe('string')
    expect(typeof data['revshare_percent']).toBe('string')
    expect(data['payout_currency']).toBe('RUB')
    expect(data['status']).toBe('active')
    expect(data['email']).toBe(PARTNER_EMAIL)
  })

  it('5. dashboard, links, commissions и players доступны по токену', async () => {
    const dashboard = await api('GET', '/affiliate/dashboard', { token })
    expect(dashboard.status).toBe(200)
    expect(asJson(dashboard.json)['period_days']).toBe(30)
    expect(typeof asJson(asJson(dashboard.json)['clicks'])['conversion_rate']).toBe('string')

    const links = await api('GET', '/affiliate/links', { token })
    expect(links.status).toBe(200)
    expect(asJson(links.json)['tracking_url']).toContain(`/go/${trackingCode}`)
    expect(Array.isArray(asJson(links.json)['examples'])).toBe(true)

    for (const path of ['/affiliate/commissions', '/affiliate/players']) {
      const res = await api('GET', path, { token })
      expect(res.status, path).toBe(200)
      expect(Array.isArray(asJson(res.json)['data']), path).toBe(true)
      expect(asJson(res.json)['meta'], path).toBeTruthy()
    }
  })

  it('6. мусор в query — 400 VALIDATION_ERROR, а не 500', async () => {
    // ZodValidationPipe по умолчанию валидирует только body; для query его
    // включали отдельно (#197), иначе `?days=abc` уезжал в Decimal и падал.
    const res = await api('GET', '/affiliate/dashboard', { token, query: '?days=abc' })
    expect(res.status).toBe(400)
    expect(res.error?.['code']).toBe('VALIDATION_ERROR')
  })

  it('7. PATCH /me с display_name реально меняет запись', async () => {
    const patch = await api('PATCH', '/affiliate/me', {
      token,
      body: { display_name: 'Переименован в e2e' },
    })
    expect(patch.status).toBe(200)
    expect(asJson(patch.json)['display_name']).toBe('Переименован в e2e')

    // Главный ассерт: не эхо запроса, а прочитанное из хранилища значение. До #198
    // сервер отвечал 200 и оставлял null, потому что схема ждала `displayName`.
    const me = await api('GET', '/affiliate/me', { token })
    expect(asJson(me.json)['display_name']).toBe('Переименован в e2e')
    const row = await prisma.affiliate.findUnique({ where: { id: affiliateId } })
    expect(row?.displayName).toBe('Переименован в e2e')
  })

  it('8. self-service не может назначить себе ставку', async () => {
    // Схема `PATCH /affiliate/me` принимает только контакты, неизвестные ключи
    // z.object вырезает. Поэтому здесь важен не код ответа, а последствие:
    // ставка обязана остаться той, что назначил оператор (ТЗ ч.8 §11.2 — ставку
    // меняет админ, партнёр нет).
    const before = await prisma.affiliate.findUnique({ where: { id: affiliateId } })
    const res = await api('PATCH', '/affiliate/me', {
      token,
      body: { revshare_rate: '0.9000', status: 'active' },
    })
    expect(res.status).toBeLessThan(500)
    const row = await prisma.affiliate.findUnique({ where: { id: affiliateId } })
    expect(row?.revshareRate.toNumber()).toBe(before?.revshareRate.toNumber())
    expect(row?.status).toBe('active')
  })

  it('9. выход из программы — suspended; начисленное остаётся доступным', async () => {
    const leave = await api('POST', '/affiliate/leave', { token })
    expect(leave.status).toBe(201)
    expect(asJson(leave.json)['status']).toBe('suspended')

    const row = await prisma.affiliate.findUnique({ where: { id: affiliateId } })
    expect(row?.status).toBe('suspended')
    // Выход — не санкция: код и накопленное не удаляются, партнёр может вернуться.
    expect(row?.trackingCode).toBe(trackingCode)

    // Старый токен продолжает отдавать кабинет: guard не смотрит на статус. Это и
    // есть смысл self-service-выхода — партнёр видит начисленное, а не теряет к нему
    // доступ. Новый же логин отказывает (403 AFFILIATE_NOT_ACTIVE) — возврат только
    // через админку; проверяем ровно это, потому что оба поведения реализованы
    // намеренно и молча поменялись местами не должны.
    const me = await api('GET', '/affiliate/me', { token })
    expect(me.status).toBe(200)
    const login = await api('POST', '/affiliate/login', {
      body: { email: PARTNER_EMAIL, password: PARTNER_PASSWORD },
    })
    expect(login.status).toBe(403)
    expect(login.error?.['code']).toBe('AFFILIATE_NOT_ACTIVE')
  })
})
