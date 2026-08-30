import { PassThrough } from 'stream'

import pino from 'pino'

import {
  buildPinoHttpOptions,
  LOG_REDACT_PATHS,
  REDACT_CENSOR,
} from '../src/common/logger/logger.options'

const SECRET_PASSWORD = 'hunter2-super-secret'
const SECRET_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiJ9.secret-part'
const SECRET_COOKIE = 'refresh_token=super-secret-refresh'
const SECRET_BODY_TOKEN = 'body-refresh-token-abc'

async function captureLog(obj: Record<string, unknown>): Promise<{ raw: string; parsed: any }> {
  const stream = new PassThrough()
  const chunks: Buffer[] = []
  stream.on('data', (c: Buffer) => chunks.push(c))
  const logger = pino(
    { level: 'info', redact: { paths: LOG_REDACT_PATHS, censor: REDACT_CENSOR } },
    stream,
  )
  logger.info(obj)
  await new Promise((r) => setImmediate(r))
  const raw = Buffer.concat(chunks).toString('utf8')
  return { raw, parsed: JSON.parse(raw) }
}

describe('GAP-23 pino redact', () => {
  it('вырезает пароль/токен/authorization/cookie на всех уровнях', async () => {
    const { raw, parsed } = await captureLog({
      password: SECRET_PASSWORD,
      token: SECRET_BODY_TOKEN,
      nested: { password: SECRET_PASSWORD, refreshToken: SECRET_BODY_TOKEN },
      deep: { inner: { token: SECRET_BODY_TOKEN } },
      req: {
        headers: { authorization: SECRET_TOKEN, cookie: SECRET_COOKIE },
        body: { password: SECRET_PASSWORD, email: 'user@example.com' },
      },
    })

    expect(parsed.password).toBe(REDACT_CENSOR)
    expect(parsed.token).toBe(REDACT_CENSOR)
    expect(parsed.nested.password).toBe(REDACT_CENSOR)
    expect(parsed.nested.refreshToken).toBe(REDACT_CENSOR)
    expect(parsed.deep.inner.token).toBe(REDACT_CENSOR)
    expect(parsed.req.headers.authorization).toBe(REDACT_CENSOR)
    expect(parsed.req.headers.cookie).toBe(REDACT_CENSOR)
    expect(parsed.req.body.password).toBe(REDACT_CENSOR)
    // не задетые поля остаются
    expect(parsed.req.body.email).toBe('user@example.com')

    // секреты физически отсутствуют в выводе
    expect(raw).not.toContain(SECRET_PASSWORD)
    expect(raw).not.toContain(SECRET_TOKEN)
    expect(raw).not.toContain(SECRET_COOKIE)
    expect(raw).not.toContain(SECRET_BODY_TOKEN)
  })

  it('buildPinoHttpOptions: redact-пути на месте, уровень по LOG_LEVEL', () => {
    const opts = buildPinoHttpOptions()
    expect(opts.redact.censor).toBe(REDACT_CENSOR)
    expect(opts.redact.paths).toContain('req.headers.authorization')
    expect(opts.redact.paths).toContain('req.body.password')
    expect(opts.redact.paths).toContain('res.headers["set-cookie"]')
    expect(opts.level).toBe(process.env['LOG_LEVEL'] ?? 'info')
  })

  it('в production без LOG_FORMAT — JSON (без pino-pretty transport)', () => {
    const prevFormat = process.env['LOG_FORMAT']
    const prevNodeEnv = process.env['NODE_ENV']
    delete process.env['LOG_FORMAT']
    process.env['NODE_ENV'] = 'production'
    try {
      const opts = buildPinoHttpOptions()
      expect(opts.transport).toBeUndefined()
    } finally {
      process.env['NODE_ENV'] = prevNodeEnv
      if (prevFormat === undefined) delete process.env['LOG_FORMAT']
      else process.env['LOG_FORMAT'] = prevFormat
    }
  })
})
