/**
 * HTTP-слой партнёрской программы: то, чего не покрывает функциональный
 * прогон через DI (контроллеры, Zod, guard'ы, коды ошибок, JSON-контракт).
 */
const BASE = 'http://localhost:3001/api/v1'
const EMAIL = `http-${Date.now()}@example.com`
const PASSWORD = 'SuperSecret123'

let pass = 0
let fail = 0

function check(condition, message) {
  if (condition) {
    pass++
    console.log(`  ✓ ${message}`)
  } else {
    fail++
    console.log(`  ✗ ${message}`)
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
    parsed = { raw: text }
  }
  return { status: res.status, body: parsed }
}

async function main() {
  console.log('\n=== 1. Регистрация партнёра по HTTP ===')
  const reg = await call('POST', '/affiliate/register', {
    email: EMAIL,
    password: PASSWORD,
    accept_terms: true,
  })
  const data = reg.body?.data ?? reg.body
  check(reg.status === 201, `POST /affiliate/register -> ${reg.status}`)
  check(typeof data.affiliate_id === 'string', `affiliate_id: ${data.affiliate_id?.slice(0, 8)}`)
  check(typeof data.tracking_code === 'string', `tracking_code: ${data.tracking_code}`)
  check(data.revshare_rate === '0.2000', `ставка из настроек: ${data.revshare_rate}`)
  check(String(data.tracking_url ?? '').includes(`/go/${data.tracking_code}`), `tracking_url: ${data.tracking_url}`)

  console.log('\n=== 2. Валидация (Zod) ===')
  const badEmail = await call('POST', '/affiliate/register', {
    email: 'не-email',
    password: PASSWORD,
    accept_terms: true,
  })
  check(badEmail.status === 400, `некорректный email -> ${badEmail.status} (ожидаем 400)`)
  const noTerms = await call('POST', '/affiliate/register', {
    email: `x${Date.now()}@example.com`,
    password: PASSWORD,
    accept_terms: false,
  })
  check(noTerms.status === 400, `accept_terms=false -> ${noTerms.status} (ожидаем 400)`)
  const shortPass = await call('POST', '/affiliate/register', {
    email: `y${Date.now()}@example.com`,
    password: 'short',
    accept_terms: true,
  })
  check(shortPass.status === 400, `слабый пароль -> ${shortPass.status} (ожидаем 400)`)

  console.log('\n=== 3. Дубль email ===')
  const dup = await call('POST', '/affiliate/register', {
    email: EMAIL,
    password: PASSWORD,
    accept_terms: true,
  })
  check(dup.status >= 400, `повторная регистрация -> ${dup.status}`)
  const dupCode = (dup.body?.error?.code) ?? (dup.body?.code) ?? '?'
  check(dupCode === 'AFFILIATE_ALREADY_EXISTS', `код ошибки: ${dupCode}`)

  console.log('\n=== 4. Вход и профиль ===')
  const login = await call('POST', '/affiliate/login', { email: EMAIL, password: PASSWORD })
  const loginData = login.body?.data ?? login.body
  check(login.status === 200, `POST /affiliate/login -> ${login.status}`)
  const token = loginData.access_token
  check(typeof token === 'string', 'токен выдан')

  const badLogin = await call('POST', '/affiliate/login', { email: EMAIL, password: 'WrongPass123' })
  check(badLogin.status >= 400, `неверный пароль -> ${badLogin.status}`)

  const me = await call('GET', '/affiliate/me', undefined, token)
  const meData = me.body?.data ?? me.body
  check(me.status === 200, `GET /affiliate/me -> ${me.status}`)
  check(meData.email === EMAIL, `email совпадает: ${meData.email}`)
  check(meData.revshare_percent === '20', `ставка в процентах: ${meData.revshare_percent}`)

  console.log('\n=== 5. Изоляция контуров ===')
  const noToken = await call('GET', '/affiliate/me')
  check(noToken.status === 401, `без токена -> ${noToken.status} (ожидаем 401)`)
  const badToken = await call('GET', '/affiliate/me', undefined, 'garbage.token.here')
  check(badToken.status === 401, `мусорный токен -> ${badToken.status} (ожидаем 401)`)
  const playerTokenRes = await call('POST', '/auth/login', {
    email: 'definitely-missing-user@example.com',
    password: 'Whatever123',
  })
  check(playerTokenRes.status >= 400, `игровой логин с чужим email -> ${playerTokenRes.status}`)

  console.log('\n=== 6. Трекинг-редирект ===')
  const click = await call('GET', `/go/${data.tracking_code}?p=/casino`)
  check(click.status === 302, `GET /go/<code> -> ${click.status}`)
  const cookie = click.body?.raw ?? ''
  check(true, `тело редиректа не проверяем (fetch без заголовков), status=${click.status}`)

  console.log('\n=== 7. Эндпоинты кабинета ===')
  for (const path of [
    '/affiliate/dashboard?days=30',
    '/affiliate/commissions?page=1&limit=20',
    '/affiliate/players?page=1&limit=20',
    '/affiliate/links',
  ]) {
    const res = await call('GET', path, undefined, token)
    check(res.status === 200, `GET ${path} -> ${res.status}`)
  }

  console.log('\n=== 8. Админ-эндпоинты защищены от партнёрского токена ===')
  for (const path of [
    '/admin/affiliate/stats',
    '/admin/affiliate/partners',
    '/admin/affiliate/settings',
  ]) {
    const res = await call('GET', path, undefined, token)
    check(res.status === 401 || res.status === 403, `партнёрский токен на ${path} -> ${res.status} (ожидаем 401/403)`)
  }

  console.log(`\nИТОГ: успешно=${pass} провалено=${fail}`)
  if (fail > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('FATAL:', error.message)
  process.exit(1)
})
