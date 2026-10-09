import { createHmac } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'

/**
 * Telegram Mini App: верификация `initData` (GAP-21, вход внутри клиента).
 *
 * Отдельная спека, а не кейсы внутри oauth-verify.spec.ts, потому что секрет
 * выводится ДРУГОЙ функцией: Mini App — HMAC-SHA256(key="WebAppData", msg=token),
 * Login Widget — SHA256(token). Если кто-то сведёт их в общий код, подпись
 * перестанет сходиться на живом устройстве, и этот файл это заметит первым.
 *
 * Критерии:
 *   1) валидный initData проходит и попадает в provisioning с правильными полями;
 *   2) подделанный hash → OAuthExchangeError, до БД дело не доходит;
 *   3) auth_date старше суток → OAuthExchangeError;
 *   4) чужой TELEGRAM_BOT_TOKEN → OAuthExchangeError;
 *   5) без TELEGRAM_BOT_TOKEN → OAuthNotConfiguredError (503);
 *   6) hash другой длины не роняет процесс (RangeError);
 *   7) имя с кириллицей, `+`, `&`, `%` внутри JSON проходит побайтово —
 *      главный регресс пересборки check-строки на сервере;
 *   8) лишнее поле в init_data ломает подпись (поля связаны hash);
 *   9) подпись проверяется до разбора `user`: битый JSON при валидном hash
 *      даёт OAuthExchangeError, аккаунт не создаётся.
 */

import { TelegramWebAppLoginUseCase } from '../src/modules/auth/application/use-cases/oauth/telegram-webapp-login.use-case'
import { OAuthExchangeError, OAuthNotConfiguredError } from '../src/modules/auth/domain/errors'

const TEST_BOT_TOKEN = '123456:telegram-bot-test-token'

interface WebAppInitDataOverrides {
  user?: Record<string, unknown>
  auth_date?: number
  start_param?: string
  chat_type?: string
  /** строка hash целиком (для кейсов «другая длина») */
  hashOverride?: string
  tamperHash?: (expected: string) => string
}

/** Подпись как у Telegram: секрет — HMAC('WebAppData', botToken). */
function signInitDataFields(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
}

/**
 * Сборка `init_data` ровно в том виде, в котором его отдаёт Telegram: значения
 * percent-encoded, вложенный `user` — JSON-строкой целиком.
 */
function buildWebAppInitData(overrides: WebAppInitDataOverrides = {}): string {
  const user = overrides.user ?? {
    id: 45367,
    first_name: 'Иван',
    last_name: 'Петров',
    username: 'ivan',
    language_code: 'ru',
  }
  const fields: Record<string, string> = {
    query_id: 'AAHdF6IQAAAAAN0XohDn59tB',
    auth_date: String(overrides.auth_date ?? Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
    v: '2.16',
  }
  if (overrides.start_param !== undefined) {
    fields.start_param = overrides.start_param
  }
  if (overrides.chat_type !== undefined) {
    fields.chat_type = overrides.chat_type
  }

  const expected = signInitDataFields(fields, TEST_BOT_TOKEN)
  fields.hash =
    overrides.hashOverride ?? (overrides.tamperHash ? overrides.tamperHash(expected) : expected)

  return Object.entries(fields)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
}

function makeUseCase(configValues: Record<string, string | undefined> = {}) {
  const defaults: Record<string, string | undefined> = { TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN }
  const config = new ConfigService({ ...defaults, ...configValues })
  const provisioning = { signIn: vi.fn() } as never
  return {
    useCase: new TelegramWebAppLoginUseCase(config, provisioning),
    signIn: (provisioning as { signIn: ReturnType<typeof vi.fn> }).signIn,
  }
}

function okSignInResult(): {
  accessToken: string
  refreshToken: string
  user: { id: string; email: string | null; role: string }
  wasLinked: boolean
} {
  return {
    accessToken: 'a',
    refreshToken: 'r',
    user: { id: 'u1', email: null, role: 'user' },
    wasLinked: false,
  }
}

describe('TelegramWebAppLoginUseCase.execute', () => {
  it('валидный initData: вход идёт под тем же telegram-линком и с именем из подписи', async () => {
    const { useCase, signIn } = makeUseCase()
    signIn.mockResolvedValue(okSignInResult())

    await useCase.execute(
      { initData: buildWebAppInitData(), referralCode: 'ABCD2345' },
      { ip: '1.1.1.1', userAgent: 'Telegram/iOS' },
    )

    expect(signIn).toHaveBeenCalledTimes(1)
    const arg = signIn.mock.calls[0]![0] as Record<string, unknown>
    expect(arg['provider']).toBe('telegram')
    expect(arg['providerUserId']).toBe('45367')
    expect(arg['displayName']).toBe('Иван Петров')
    expect(arg['referralCode']).toBe('ABCD2345')
  })

  it('имя с кириллицей, +, & и % выживает: сервер не пересобирает JSON', async () => {
    const { useCase, signIn } = makeUseCase()
    signIn.mockResolvedValue(okSignInResult())

    const trickyUser = { id: 45367, first_name: 'Анна + Марк & 100%' }
    await useCase.execute({ initData: buildWebAppInitData({ user: trickyUser }) })

    const arg = signIn.mock.calls[0]![0] as Record<string, unknown>
    expect(arg['displayName']).toBe('Анна + Марк & 100%')
  })

  it('подмешанное поле ломает подпись: init_data связан hash целиком', async () => {
    const { useCase, signIn } = makeUseCase()
    signIn.mockResolvedValue(okSignInResult())

    const tampered = `${buildWebAppInitData({ chat_type: 'sender' })}&evil=1`
    await expect(useCase.execute({ initData: tampered })).rejects.toBeInstanceOf(OAuthExchangeError)
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('TelegramWebAppLoginUseCase.verify', () => {
  it('подделанный hash → OAuthExchangeError, до provisioning дело не доходит', async () => {
    const { useCase, signIn } = makeUseCase()
    await expect(
      useCase.execute({
        initData: buildWebAppInitData({ tamperHash: (expected) => `${expected.slice(0, -1)}0` }),
      }),
    ).rejects.toBeInstanceOf(OAuthExchangeError)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('auth_date старше суток → OAuthExchangeError', async () => {
    const { useCase } = makeUseCase()
    const stale = Math.floor(Date.now() / 1000) - 86_401
    await expect(
      useCase.execute({ initData: buildWebAppInitData({ auth_date: stale }) }),
    ).rejects.toBeInstanceOf(OAuthExchangeError)
  })

  it('подпись другого бота не проходит', async () => {
    const { useCase } = makeUseCase({ TELEGRAM_BOT_TOKEN: '999999:another-bot-token' })
    await expect(useCase.execute({ initData: buildWebAppInitData() })).rejects.toBeInstanceOf(
      OAuthExchangeError,
    )
  })

  it('без TELEGRAM_BOT_TOKEN → OAuthNotConfiguredError (503)', async () => {
    const { useCase } = makeUseCase({ TELEGRAM_BOT_TOKEN: undefined })
    const execute = (): Promise<unknown> => useCase.execute({ initData: buildWebAppInitData() })

    await expect(execute()).rejects.toBeInstanceOf(OAuthNotConfiguredError)
    await expect(execute()).rejects.toMatchObject({ httpStatus: 503 })
  })

  it('hash другой длины не роняет процесс (timingSafeEqual за проверкой длины)', async () => {
    const { useCase } = makeUseCase()
    await expect(
      useCase.execute({ initData: buildWebAppInitData({ hashOverride: 'abc' }) }),
    ).rejects.toBeInstanceOf(OAuthExchangeError)
  })

  it('init_data без подписи → OAuthExchangeError', async () => {
    const { useCase } = makeUseCase()
    const withoutHash = buildWebAppInitData().replace(/&hash=[0-9a-f]+/, '')
    await expect(useCase.execute({ initData: withoutHash })).rejects.toBeInstanceOf(
      OAuthExchangeError,
    )
  })

  it('битый JSON в user при валидной подписи: подпись проверена первой, аккаунт не создаётся', async () => {
    const { useCase, signIn } = makeUseCase()
    signIn.mockResolvedValue(okSignInResult())

    const fields: Record<string, string> = {
      query_id: 'AAHdF6IQAAAAAN0XohDn59tB',
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: 'это не JSON',
      v: '2.16',
    }
    fields.hash = signInitDataFields(fields, TEST_BOT_TOKEN)
    const initData = Object.entries(fields)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&')

    await expect(useCase.execute({ initData })).rejects.toBeInstanceOf(OAuthExchangeError)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('user без id → OAuthExchangeError', async () => {
    const { useCase, signIn } = makeUseCase()
    signIn.mockResolvedValue(okSignInResult())
    await expect(
      useCase.execute({ initData: buildWebAppInitData({ user: { first_name: 'Без ID' } }) }),
    ).rejects.toBeInstanceOf(OAuthExchangeError)
  })
})
