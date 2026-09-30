/*
 * Автономный Node-скрипт проверки: CommonJS и без типов, поэтому правила
 * модулей приложения к нему неприменимы — require() и console здесь норма,
 * а type-aware правила видят только any.
 */
/* eslint-disable no-console, max-lines-per-function, max-depth, max-params, @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition */
/**
 * HTTP-проверка партнёрской программы: контроллеры, Zod, guard'ы, контракт.
 *
 * Дополняет функциональный прогон (apps/api/test/affiliate-flow.check.js),
 * который идёт в обход HTTP через DI-контейнер и потому не видит границу
 * API: пропущенные @CurrentUser/@Query, camelCase/snake_case в DTO,
 * коды ошибок и заголовки авторизации.
 *
 * Требует запущенного API: pnpm --filter @casino/api start
 */
const BASE = process.env.AFFILIATE_API_URL ?? 'http://localhost:3001/api/v1'
const PASSWORD = 'SuperSecret123'

let pass = 0
let fail = 0

function check(condition, message) {
  if (condition) {
    pass++
    console.log(`  OK   ${message}`)
  } else {
    fail++
    console.log(`  FAIL ${message}`)
  }
}

async function call(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  return { status: res.status, body: parsed, text }
}

const unique = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`

async function main() {
  console.log(`\n=== 1. Регистрация (HTTP-контракт snake_case) ===`)
  const email = unique('http')
  const reg = await call('POST', '/affiliate/register', {
    email,
    password: PASSWORD,
    accept_terms: true,
    display_name: 'Проверка HTTP',
  })
  const regData = reg.body?.data
  check(reg.status === 201, `POST /affiliate/register -> ${reg.status}`)
  check(typeof regData?.affiliate_id === 'string', `affiliate_id получен`)
  check(typeof regData?.tracking_code === 'string', `tracking_code=${regData?.tracking_code}`)
  check(regData?.revshare_rate === '0.2000', `ставка из настроек: ${regData?.revshare_rate}`)

  console.log(`\n=== 2. Валидация тела ===`)
  check(
    (
      await call('POST', '/affiliate/register', {
        email: 'bad',
        password: PASSWORD,
        accept_terms: true,
      })
    ).status === 400,
    'некорректный email -> 400',
  )
  check(
    (
      await call('POST', '/affiliate/register', {
        email: unique('t'),
        password: PASSWORD,
        accept_terms: false,
      })
    ).status === 400,
    'accept_terms=false -> 400',
  )
  check(
    (
      await call('POST', '/affiliate/register', {
        email: unique('t'),
        password: 'short',
        accept_terms: true,
      })
    ).status === 400,
    'слабый пароль -> 400',
  )

  console.log(`\n=== 3. Дубль email ===`)
  const dup = await call('POST', '/affiliate/register', {
    email,
    password: PASSWORD,
    accept_terms: true,
  })
  check(dup.status === 409, `повторная регистрация -> ${dup.status}`)
  check(dup.body?.error?.code === 'AFFILIATE_ALREADY_EXISTS', `код: ${dup.body?.error?.code}`)

  console.log(`\n=== 4. Вход и профиль ===`)
  const login = await call('POST', '/affiliate/login', { email, password: PASSWORD })
  const token = (login.body?.data ?? login.body)?.access_token
  check(typeof token === 'string', `POST /affiliate/login -> ${login.status}, токен выдан`)
  check(
    (await call('POST', '/affiliate/login', { email, password: 'WrongPass1' })).status === 401,
    'неверный пароль -> 401',
  )

  const me = await call('GET', '/affiliate/me', undefined, token)
  const meData = me.body?.data
  check(me.status === 200, `GET /affiliate/me -> ${me.status}`)
  check(meData?.email === email, `email в профиле совпадает`)
  check(
    meData?.display_name === 'Проверка HTTP',
    `display_name из snake_case-контракта сохранён: ${meData?.display_name}`,
  )
  check(meData?.revshare_percent === '20', `ставка в процентах: ${meData?.revshare_percent}`)

  console.log(`\n=== 5. Авторизация ===`)
  check((await call('GET', '/affiliate/me')).status === 401, 'без токена -> 401')
  check(
    (await call('GET', '/affiliate/me', undefined, 'garbage.token.here')).status === 401,
    'мусорный токен -> 401',
  )
  for (const path of ['/admin/affiliate/partners', '/admin/affiliate/settings']) {
    check(
      [401, 403].includes((await call('GET', path, undefined, token)).status),
      `партнёрский токен на ${path} отвергнут`,
    )
  }

  console.log(`\n=== 6. Трекинг ===`)
  const click = await call('GET', `/go/${regData.tracking_code}?p=/casino`)
  check(click.status === 302, `GET /go/<code> -> ${click.status}`)
  const unknown = await call('GET', '/go/ZZZZZZZZ')
  check(unknown.status === 302, `неизвестный код всё равно редиректит -> ${unknown.status}`)

  console.log(`\n=== 7. Эндпоинты кабинета (регрессия @CurrentUser/@Query) ===`)
  for (const path of [
    '/affiliate/dashboard?days=30',
    '/affiliate/commissions?page=1&per_page=20',
    '/affiliate/players',
    '/affiliate/links',
  ]) {
    const res = await call('GET', path, undefined, token)
    check(res.status === 200, `GET ${path} -> ${res.status}`)
  }

  console.log(`\n=== 8. Изменение профиля (граница DTO) ===`)
  const upd = await call(
    'PATCH',
    '/affiliate/me',
    { display_name: 'Новое имя', telegram: '@test' },
    token,
  )
  check(upd.status === 200, `PATCH /affiliate/me -> ${upd.status}`)
  check(
    upd.body?.data?.display_name === 'Новое имя',
    `display_name обновлён: ${upd.body?.data?.display_name}`,
  )

  console.log(`\nИТОГ: успешно=${pass} провалено=${fail}`)
  console.log(`Тестовый партнёр: ${email} (удалить: prisma.affiliate.deleteMany по email)`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('FATAL:', error.message)
  process.exit(1)
})
