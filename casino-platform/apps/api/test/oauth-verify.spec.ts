import { createHash, createHmac } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'

/**
 * GAP-42: верификация OAuth-подписей не покрыта ни одним тестом.
 *
 * Это чистые функции — боевые ключи не нужны, тестируются с фиктивными секретами.
 * Сценарии по критерию приёмки GAP-42:
 *   Telegram:
 *     1) валидный hash проходит (вызов доходит до provisioning);
 *     2) подделанный hash → OAuthExchangeError;
 *     3) auth_date старше 24ч → OAuthExchangeError;
 *     4) без TELEGRAM_BOT_TOKEN → OAuthNotConfiguredError (503);
 *     5) hash другой длины не роняет процесс (timingSafeEqual защищён проверкой длины).
 *   Google:
 *     6) buildAuthUrl() → verifyState() round-trip ок;
 *     7) подменённая подпись в state → OAuthStateError;
 *     8) state старше 10 минут → OAuthStateError;
 *     9) state отсутствует → OAuthStateError;
 *    10) без GOOGLE_CLIENT_ID → OAuthNotConfiguredError (503) на buildAuthUrl;
 *    11) без GOOGLE_CLIENT_SECRET → OAuthNotConfiguredError (503) на execute.
 *
 * HTTP-обмен с Google НЕ мокается: это runtime (GAP-46). Здесь мы затрагиваем
 * только локальные криптопримитивы (signState/verifyState). state-кейсы ловятся
 * ДО `fetch` — verifyState стоит первым после credentials().
 *
 * Провайдер-сервис провижионинга подменяется stub'ом (signIn: vi.fn()).
 * vi.mock на module не используем: use-case получает зависимости через DI
 * (конструктор), мок модуля не подменяет переданный инстанс.
 */

import { TelegramLoginUseCase } from '../src/modules/auth/application/use-cases/oauth/telegram-login.use-case'
import { GoogleOAuthUseCase } from '../src/modules/auth/application/use-cases/oauth/google-oauth.use-case'
import {
  OAuthExchangeError,
  OAuthNotConfiguredError,
  OAuthStateError,
} from '../src/modules/auth/domain/errors'

// -------------------- Telegram helpers --------------------

/** Формирует валидный data-check-string + hex-HMAC для TelegramLoginWidget. */
function buildTelegramPayload(overrides: {
  id?: number
  auth_date?: number
  first_name?: string
  username?: string
  last_name?: string
  photo_url?: string
  /** если задано — подделываем финальный hash (полезно для негативных кейсов) */
  tamperHash?: (expected: string) => string
} = {}) {
  const id = overrides.id ?? 12345
  const authDate = overrides.auth_date ?? Math.floor(Date.now() / 1000)
  const fields: Record<string, string> = {
    id: String(id),
    auth_date: String(authDate),
  }
  if (overrides.first_name) fields.first_name = overrides.first_name
  if (overrides.last_name) fields.last_name = overrides.last_name
  if (overrides.username) fields.username = overrides.username
  if (overrides.photo_url) fields.photo_url = overrides.photo_url

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')

  const botToken = '123456:telegram-bot-test-token'
  const secret = createHash('sha256').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex')

  // exactOptionalPropertyTypes: optional-свойства нельзя явно класть как undefined.
  const payload = {
    id,
    auth_date: authDate,
    hash: overrides.tamperHash ? overrides.tamperHash(expected) : expected,
    ...(overrides.first_name && { first_name: overrides.first_name }),
    ...(overrides.last_name && { last_name: overrides.last_name }),
    ...(overrides.username && { username: overrides.username }),
    ...(overrides.photo_url && { photo_url: overrides.photo_url }),
  }
  return { payload, botToken }
}

function makeTelegramUseCase(configValues: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: '123456:telegram-bot-test-token',
  }
  const config = new ConfigService({ ...defaults, ...configValues })
  // Прямой stub: use-case получает provisioning через DI (конструктор), не через
  // import — vi.mock на модуль здесь не поможет.
  const provisioning = { signIn: vi.fn() } as never
  return { useCase: new TelegramLoginUseCase(config, provisioning), provisioning }
}

// ==================== Telegram ====================

describe('GAP-42 TelegramLoginUseCase.verify', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('валидный hash проходит — provisioning вызван с правильными полями', async () => {
    const { useCase, provisioning } = makeTelegramUseCase()
    const signIn = (provisioning as { signIn: ReturnType<typeof vi.fn> }).signIn
    signIn.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: 'u1', email: null, role: 'user' },
      wasLinked: false,
    })

    const { payload } = buildTelegramPayload({ first_name: 'Ivan', username: 'ivan' })
    await useCase.execute(payload, { ip: '1.1.1.1', userAgent: 'jest' })

    expect(signIn).toHaveBeenCalledTimes(1)
    const arg = signIn.mock.calls[0]?.[0]
    expect(arg.provider).toBe('telegram')
    expect(arg.providerUserId).toBe('12345')
    expect(arg.displayName).toBe('Ivan')
    expect(arg.ip).toBe('1.1.1.1')
    expect(arg.userAgent).toBe('jest')
  })

  it('подделанный hash → OAuthExchangeError, provisioning не вызван', async () => {
    const { useCase, provisioning } = makeTelegramUseCase()
    const signIn = (provisioning as { signIn: ReturnType<typeof vi.fn> }).signIn
    signIn.mockResolvedValue({} as never)

    const { payload } = buildTelegramPayload({
      tamperHash: (expected) => {
        // меняем ровно один символ в середине, оставляя длину
        const mid = Math.floor(expected.length / 2)
        return expected.slice(0, mid) + (expected[mid] === 'a' ? 'b' : 'a') + expected.slice(mid + 1)
      },
    })

    await expect(useCase.execute(payload)).rejects.toBeInstanceOf(OAuthExchangeError)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('auth_date старше 24ч → OAuthExchangeError', async () => {
    const { useCase, provisioning } = makeTelegramUseCase()
    const signIn = (provisioning as { signIn: ReturnType<typeof vi.fn> }).signIn
    signIn.mockResolvedValue({} as never)

    const old = Math.floor(Date.now() / 1000) - 86_401 // 1 секунда за пределами окна
    const { payload } = buildTelegramPayload({ auth_date: old })

    await expect(useCase.execute(payload)).rejects.toBeInstanceOf(OAuthExchangeError)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('без TELEGRAM_BOT_TOKEN → OAuthNotConfiguredError (503)', async () => {
    const { useCase, provisioning } = makeTelegramUseCase({ TELEGRAM_BOT_TOKEN: '' })
    const signIn = (provisioning as { signIn: ReturnType<typeof vi.fn> }).signIn
    signIn.mockResolvedValue({} as never)

    const { payload } = buildTelegramPayload()

    let caught: unknown
    try {
      await useCase.execute(payload)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(OAuthNotConfiguredError)
    expect((caught as OAuthNotConfiguredError).httpStatus).toBe(503)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('hash неверной длины → OAuthExchangeError, процесс не падает', async () => {
    // Передаём hash короче ожидаемого (должен быть 64 hex). timingSafeEqual
    // без проверки длины бросил бы RangeError — verify обязан сравнить длины
    // и тихо вернуть ошибку обмена.
    const { useCase, provisioning } = makeTelegramUseCase()
    const signIn = (provisioning as { signIn: ReturnType<typeof vi.fn> }).signIn
    signIn.mockResolvedValue({} as never)

    const { payload } = buildTelegramPayload({
      tamperHash: () => 'abcd',
    })

    await expect(useCase.execute(payload)).rejects.toBeInstanceOf(OAuthExchangeError)
    expect(signIn).not.toHaveBeenCalled()
  })
})

// ==================== Google helpers ====================

function makeGoogleConfig(overrides: Record<string, string> = {}) {
  return new ConfigService({
    JWT_ACCESS_SECRET: 'test-jwt-secret-for-oauth-state',
    GOOGLE_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'GOCSPX-test_secret_value',
    APP_URL: 'https://example.com',
    ...overrides,
  })
}

function makeGoogleUseCase(configValues: Record<string, string> = {}) {
  const config = makeGoogleConfig(configValues)
  const provisioning = { signIn: vi.fn() } as never
  return {
    useCase: new GoogleOAuthUseCase(config, provisioning),
    provisioning,
  }
}

// ==================== Google ====================

describe('GAP-42 GoogleOAuthUseCase', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('buildAuthUrl формирует корректный URL с state', () => {
    const { useCase } = makeGoogleUseCase()

    const { state, url } = useCase.buildAuthUrl()
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(url).toContain('accounts.google.com')
    expect(url).toContain(`state=${encodeURIComponent(state)}`)
    expect(url).toContain(
      'client_id=google-client-id.apps.googleusercontent.com',
    )
  })

  it('buildAuthUrl → verifyState round-trip: валидный state проходит (execute падает на credentials/fetch, но НЕ на state)', async () => {
    // credentials() оба ключа проверит ОК, verifyState примет state ДО fetch.
    // fetch замокан в failed — execute бросит OAuthExchangeError (а не OAuthStateError).
    // Это подтверждает, что verifyState пропустил валидный state.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network unreachable in test')),
    )

    const { useCase } = makeGoogleUseCase()
    const { state } = useCase.buildAuthUrl()

    let caught: unknown
    try {
      await useCase.execute({
        code: 'any-code',
        redirectUri: 'https://example.com/cb',
        state,
      })
    } catch (e) {
      caught = e
    }
    // Не OAuthStateError — это значит state прошёл проверку.
    expect(caught).toBeInstanceOf(OAuthExchangeError)
  })

  it('подменённая подпись в state → OAuthStateError', async () => {
    // credentials() пройдёт (ключи заполнены), verifyState отвергнет подделанный state.
    const { useCase } = makeGoogleUseCase()

    const { state } = useCase.buildAuthUrl()
    const [body, sig] = state.split('.')
    const lastChar = sig!.slice(-1)
    const swapped = lastChar === 'A' ? 'B' : 'A'
    const tampered = `${body}.${sig!.slice(0, -1)}${swapped}`

    await expect(
      useCase.execute({
        code: 'x',
        redirectUri: 'https://example.com/cb',
        state: tampered,
      }),
    ).rejects.toBeInstanceOf(OAuthStateError)
  })

  it('state старше 10 минут → OAuthStateError', async () => {
    const { useCase } = makeGoogleUseCase()

    // Генерируем state напрямую с timestamp 10 минут + 1 секунда в прошлом.
    const body = Buffer.from(
      JSON.stringify({ t: Date.now() - (10 * 60 * 1000 + 1000) }),
    ).toString('base64url')
    const sig = createHmac('sha256', 'test-jwt-secret-for-oauth-state')
      .update(body)
      .digest('base64url')
    const expiredState = `${body}.${sig}`

    await expect(
      useCase.execute({
        code: 'x',
        redirectUri: 'https://example.com/cb',
        state: expiredState,
      }),
    ).rejects.toBeInstanceOf(OAuthStateError)
  })

  it('state отсутствует → OAuthStateError', async () => {
    const { useCase } = makeGoogleUseCase()

    await expect(
      useCase.execute({ code: 'x', redirectUri: 'https://example.com/cb' }),
    ).rejects.toBeInstanceOf(OAuthStateError)
  })

  it('без GOOGLE_CLIENT_ID → OAuthNotConfiguredError (503) на buildAuthUrl', () => {
    const { useCase } = makeGoogleUseCase({ GOOGLE_CLIENT_ID: '' })

    let caught: unknown
    try {
      useCase.buildAuthUrl()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(OAuthNotConfiguredError)
    expect((caught as OAuthNotConfiguredError).httpStatus).toBe(503)
  })

  it('без GOOGLE_CLIENT_SECRET → OAuthNotConfiguredError (503) на execute', async () => {
    // buildAuthUrl() тоже требует оба ключа (через credentials()), поэтому
    // генерируем state напрямую: credentials() вызывается ПЕРВЫМ в execute и
    // бросит до verifyState — содержимое state не важно.
    const { useCase } = makeGoogleUseCase({ GOOGLE_CLIENT_SECRET: '' })
    const fakeState = `${Buffer.from(JSON.stringify({ t: Date.now() })).toString('base64url')}.sig`

    let caught: unknown
    try {
      await useCase.execute({ code: 'x', state: fakeState })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(OAuthNotConfiguredError)
    expect((caught as OAuthNotConfiguredError).httpStatus).toBe(503)
  })
})
