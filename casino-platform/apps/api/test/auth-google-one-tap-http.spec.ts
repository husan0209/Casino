import { describe, expect, it, vi } from 'vitest'

/**
 * HTTP-контракт Google One Tap: GET /auth/google/one-tap/nonce и
 * POST /auth/google/credential.
 *
 * Криптографию и сверку nonce проверяют google-id-token-verifier.spec.ts и
 * google-one-tap.spec.ts; здесь предмет связывающий слой: pipe, форма тела,
 * имя и флаги куки nonce, съём куки после обмена и refresh-кука сессии. Именно
 * на связывании «код правильный, а входа нет» и ломаются OAuth-потоки.
 */

import { AuthController } from '../src/modules/auth/presentation/controllers/auth.controller'
import { GoogleOneTapLoginSchema } from '../src/modules/auth/presentation/dto/oauth.dto'

const CONTROLLER_ARITY = 14
const CREDENTIAL = 'one-tap-credential-fixture-0123456789abcdef'

function makeController(): {
  controller: AuthController
  execute: ReturnType<typeof vi.fn>
  issueNonce: ReturnType<typeof vi.fn>
  res: { cookie: ReturnType<typeof vi.fn>; clearCookie: ReturnType<typeof vi.fn> }
} {
  const execute = vi.fn().mockResolvedValue({
    accessToken: 'jwt',
    refreshToken: 'refresh-token-value',
    user: { id: 'u1', email: 'ivan@example.com', role: 'user' },
    wasLinked: false,
  })
  const issueNonce = vi.fn().mockReturnValue({ value: 'nonce-value', cookie: 'body.signature' })
  const args = new Array(CONTROLLER_ARITY).fill(undefined) as never[]
  const controller = new (AuthController as unknown as new (...deps: never[]) => AuthController)(
    ...args,
  )
  Object.assign(controller as unknown as Record<string, unknown>, {
    googleOneTapUc: { execute, issueNonce },
  })
  return { controller, execute, issueNonce, res: { cookie: vi.fn(), clearCookie: vi.fn() } }
}

describe('GoogleOneTapLoginSchema', () => {
  it('принимает credential и опциональный реферал', () => {
    const parsed = GoogleOneTapLoginSchema.safeParse({
      credential: CREDENTIAL,
      referral_code: 'REF9',
    })

    expect(parsed.success).toBe(true)
  })

  it('лишние поля в теле — отказ: набор полей у credential-потока фиксирован', () => {
    expect(GoogleOneTapLoginSchema.safeParse({ credential: CREDENTIAL, sub: 'g-1' }).success).toBe(
      false,
    )
  })

  it('credential обязателен, минимален и ограничен по длине', () => {
    expect(GoogleOneTapLoginSchema.safeParse({}).success).toBe(false)
    expect(GoogleOneTapLoginSchema.safeParse({ credential: 'short' }).success).toBe(false)
    expect(GoogleOneTapLoginSchema.safeParse({ credential: 'a'.repeat(16_385) }).success).toBe(
      false,
    )
  })
})

describe('AuthController.googleOneTapNonce', () => {
  it('в тело идёт значение, в куку — подписанный конверт', () => {
    const { controller, issueNonce, res } = makeController()

    const result = controller.googleOneTapNonce(res as never)

    expect(issueNonce).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ nonce: 'nonce-value' })
    expect(res.cookie).toHaveBeenCalledWith(
      'g_one_tap',
      'body.signature',
      expect.objectContaining({ httpOnly: true, path: '/api/v1/auth', sameSite: 'strict' }),
    )
  })
})

describe('AuthController.googleCredential', () => {
  it('несёт credential, nonce из куки и метаданные запроса в use-case', async () => {
    const { controller, execute, res } = makeController()
    const req = {
      cookies: { g_one_tap: 'body.signature' },
      ip: '203.0.113.9',
      headers: { 'user-agent': 'Chrome' },
    } as never

    const result = await controller.googleCredential(
      { credential: CREDENTIAL, referral_code: 'REF9' },
      req,
      res as never,
    )

    expect(execute.mock.calls[0]![0]).toMatchObject({
      credential: CREDENTIAL,
      nonceCookie: 'body.signature',
      referralCode: 'REF9',
      ip: '203.0.113.9',
      userAgent: 'Chrome',
    })
    expect(result).toEqual({
      accessToken: 'jwt',
      user: { id: 'u1', email: 'ivan@example.com', role: 'user' },
    })
  })

  it('после обмена снимает куку nonce и ставит refresh-куку сессии', async () => {
    const { controller, res } = makeController()
    const req = { cookies: {}, ip: undefined, headers: {} } as never

    await controller.googleCredential({ credential: CREDENTIAL }, req, res as never)

    // Одноразовость: без съёма куки этот же credential приняли бы повторно в окне TTL.
    expect(res.clearCookie).toHaveBeenCalledWith(
      'g_one_tap',
      expect.objectContaining({ path: '/api/v1/auth' }),
    )
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token-value',
      expect.objectContaining({ httpOnly: true, path: '/api/v1/auth', sameSite: 'strict' }),
    )
  })

  it('отказ use-case наружу не подменяется: кука не снимается', async () => {
    const { controller, execute, res } = makeController()
    execute.mockRejectedValueOnce(new Error('Токен провайдера не прошёл проверку: nonce'))

    await expect(
      controller.googleCredential(
        { credential: CREDENTIAL },
        { cookies: {}, headers: {} } as never,
        res as never,
      ),
    ).rejects.toThrow(/nonce/)
    expect(res.clearCookie).not.toHaveBeenCalled()
  })
})
