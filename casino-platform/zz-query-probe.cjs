const BASE = 'http://localhost:3001/api/v1'
const EMAIL = `q-${Date.now()}@example.com`
const PASSWORD = 'SuperSecret123'

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
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text }
  }
  return { status: res.status, body: parsed }
}

async function main() {
  await call('POST', '/affiliate/register', {
    email: EMAIL,
    password: PASSWORD,
    accept_terms: true,
  })
  const login = await call('POST', '/affiliate/login', { email: EMAIL, password: PASSWORD })
  const token = (login.body?.data ?? login.body).access_token

  const cases = [
    ['как шлёт web: page + per_page', '/affiliate/commissions?page=1&per_page=20'],
    ['только page (без per_page)', '/affiliate/commissions?page=1'],
    ['без параметров вовсе', '/affiliate/commissions'],
    ['неизвестный статус', '/affiliate/commissions?page=1&per_page=20&status=bogus'],
    ['мусорный page', '/affiliate/commissions?page=abc'],
  ]

  for (const [label, path] of cases) {
    const res = await call('GET', path, undefined, token)
    const note = res.status === 200 ? 'OK' : JSON.stringify(res.body?.error?.code ?? res.status)
    console.log(`  ${label.padEnd(32)} -> ${res.status}  (${note})`)
  }
}

main().catch((error) => {
  console.error('FATAL', error.message)
})
