const BASE = 'http://localhost:3001/api/v1'

async function show(label, method, path, body, token) {
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
  console.log(`\n### ${label}`)
  console.log(`    ${method} ${path} -> ${res.status}`)
  try {
    console.log('    ' + JSON.stringify(JSON.parse(text), null, 2).split('\n').join('\n    '))
  } catch {
    console.log('    (non-JSON) ' + text.slice(0, 400))
  }
}

async function main() {
  await show('register valid', 'POST', '/affiliate/register', {
    email: `dbg-${Date.now()}@example.com`,
    password: 'SuperSecret123',
    accept_terms: true,
  })

  await show('auth login (existing seeded admin as player?)', 'POST', '/auth/login', {
    email: 'nobody-here@example.com',
    password: 'SomePassword123',
  })

  await show('auth register', 'POST', '/auth/register', {
    email: `dbgplayer-${Date.now()}@example.com`,
    password: 'PlayerPass123',
  })
}

main().catch((error) => {
  console.error('FATAL', error.message)
})
