import { describe, expect, it, vi } from 'vitest'

/**
 * HTTP-контракт POST /auth/telegram/webapp (GAP-75).
 *
 * Юнит-спека use-case проверяет подпись, но не проверяет связывание: pipe,
 * форму тела, cookie и конверт. Именно на связывании живой Mini App и ломается
 * — «код правильный, а сессии нет».
 */

import { AuthController } from '../src/modules/auth/presentation/controllers/auth.controller'
import { TelegramWebAppLoginSchema } from '../src/modules/auth/presentation/dto/oauth.dto'

const CONTROLLER_ARITY = 13

function makeController(): {
  controller: AuthController
  execute: ReturnType<typeof vi.fn>
  res: { cookie: ReturnType<typeof vi.fn> }
} {
  const execute = vi.fn().mockResolvedValue({
    accessToken: 'jwt',
    refreshToken: 'refresh-token-value',
    user: { id: 'u1', email: null, role: 'user' },
    wasLinked: true,
  })
  /**
   * Подменяем сам use-case, а не его зависимости: криптография проверена в
   * telegram-webapp-verify.spec.ts, здесь важен только связывающий слой.
   */
  const useCase = { execute } as never
  const args = new Array(CONTROLLER_ARITY).fill(undefined) as never[]
  const controller = new (AuthController as unknown as new (...deps: never[]) => AuthController)(
    ...args,
  )
  Object.assign(controller as unknown as Record<string, unknown>, { telegramWebAppUc: useCase })
  return { controller, execute, res: { cookie: vi.fn() } }
}

describe('TelegramWebAppLoginSchema', () => {
  it('принимает сырую строку и опциональный реферал', () => {
    const parsed = TelegramWebAppLoginSchema.safeParse({
      init_data: 'query_id=AAA&user=%7B%7D&auth_date=1&hash=abcd',
      referral_code: 'REF9',
    })

    expect(parsed.success).toBe(true)
  })

  it('лишнее поле в теле — отказ: набор полей initData сервер получает из строки', () => {
    expect(
      TelegramWebAppLoginSchema.safeParse({ init_data: 'a=b&hash=abcd', id: '45367' }).success,
    ).toBe(false)
  })

  it('init_data обязателен и ограничен по длине', () => {
    expect(TelegramWebAppLoginSchema.safeParse({}).success).toBe(false)
    expect(TelegramWebAppLoginSchema.safeParse({ init_data: '' }).success).toBe(false)
    expect(TelegramWebAppLoginSchema.safeParse({ init_data: 'a'.repeat(9000) }).success).toBe(false)
  })

  it('реферальный код длиннее 32 символов — отказ', () => {
    expect(
      TelegramWebAppLoginSchema.safeParse({
        init_data: 'query_id=AAA&auth_date=1&hash=abcd',
        referral_code: 'R'.repeat(33),
      }).success,
    ).toBe(false)
  })
})

describe('AuthController.telegramWebApp', () => {
  it('кладёт refresh в httpOnly-cookie и отдаёт пару accessToken/user', async () => {
    const { controller, execute, res } = makeController()
    const req = { ip: '203.0.113.9', headers: { 'user-agent': 'Telegram/Android' } } as never

    const result = await controller.telegramWebApp(
      { init_data: 'query_id=AAA&auth_date=1&hash=abcd' },
      req,
      res as never,
    )

    expect(execute).toHaveBeenCalledTimes(1)
    // Без этой куки Mini App не переживёт перезапуск окна: access-token живёт
    // только в памяти, а в WebView он теряется на каждом закрытии приложения.
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token-value',
      expect.objectContaining({ httpOnly: true, path: '/api/v1/auth', sameSite: 'strict' }),
    )
    expect(result).toEqual({ accessToken: 'jwt', user: { id: 'u1', email: null, role: 'user' } })
  })

  it('referral_code доезжает до use-case, отсутствие — не подставляется undefined', async () => {
    const { controller, execute, res } = makeController()
    const req = { ip: undefined, headers: {} } as never

    await controller.telegramWebApp(
      { init_data: 'query_id=AAA&auth_date=1&hash=abcd', referral_code: 'REF9' },
      req,
      res as never,
    )

    const input = execute.mock.calls[0]![0] as Record<string, unknown>
    expect(input['referralCode']).toBe('REF9')
    expect(Object.keys(input)).toEqual(['initData', 'referralCode'])
  })
})
