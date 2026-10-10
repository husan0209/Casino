import { createHmac } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'

/**
 * Telegram Mini App: верификация `initData` (GAP-75, вход внутри клиента).
 *
 * Отдельная спека, а не кейсы внутри oauth-verify.spec.ts, потому что секрет
 * выводится ДРУГОЙ функцией: Mini App — HMAC-SHA256(key="WebAppData", msg=token),
 * Login Widget — SHA256(token). Если кто-то сведёт их в общий код, подпись
 * перестанет сходиться на живом устройстве, и этот файл это заметит первым.
 *
 * Честно о слабом месте любых самопроверяемых крипто-тестов: buildWebAppInitData
 * повторяет алгоритм Telegram, а не берёт живую подпись. Поэтому здесь есть
 * ЯКОРЯ, которые нельзя получить «из той же головы»:
 *   - константа "WebAppData" и порядок (ключ = константа, сообщение = токен) —
 *     они зафиксированы в спеке отдельной строкой, а не вычислены;
 *   - `signature` в подписанный набор входит, но из check-строки ИСКЛЮЧЁН;
 *   - `user` — JSON-строка с percent-экранированием, а не объект.
 * Живой прогон в клиенте Telegram по-прежнему обязателен (GAP-75 = CODE_DONE).
 */

import { TelegramWebAppLoginUseCase } from '../src/modules/auth/application/use-cases/oauth/telegram-webapp-login.use-case'
import { OAuthExchangeError, OAuthNotConfiguredError } from '../src/modules/auth/domain/errors'

const TEST_BOT_TOKEN = '123456:telegram-bot-test-token'
/** Свежий auth_date: окно Mini App — минуты, поэтому тесты считают его на лету. */
const NOW_SEC = Math.floor(Date.now() / 1000)

interface WebAppInitDataOverrides {
  user?: Record<string, unknown>
  auth_date?: number
  start_param?: string
  chat_type?: string
  /** подпись Ed25519: Telegram отдаёт её отдельной строкой, в check-string её нет */
  withSignature?: boolean
  hashOverride?: string
  tamperHash?: (expected: string) => string
}

/**
 * Подпись по спецификации Telegram: секрет — HMAC-SHA256 с ключом "WebAppData"
 * на токене, затем HMAC-SHA256 на этом секрете по отсортированной check-строке
 * из ВСЕХ полей, кроме hash и signature.
 */
function signInitDataFields(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .filter((key) => key !== 'hash' && key !== 'signature')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
}

/**
 * Сборка `init_data` в том виде, в котором её отдаёт Telegram: значения
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
    auth_date: String(overrides.auth_date ?? NOW_SEC),
    user: JSON.stringify(user),
    v: '2.16',
  }
  if (overrides.start_param !== undefined) {
    fields.start_param = overrides.start_param
  }
  if (overrides.chat_type !== undefined) {
    fields.chat_type = overrides.chat_type
  }
  if (overrides.withSignature === true) {
    fields.signature = 'Fvz0Y1v7Xqa6Wu7VXGkpo2C7vD3xW1qZ0m6E6u0eZ1Qc6t1s2u4w5e6r7t8y9u0i'
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
  const provisioning = { signIn: vi.fn(), hasAccount: vi.fn() } as never
  const stubs = provisioning as {
    signIn: ReturnType<typeof vi.fn>
    hasAccount: ReturnType<typeof vi.fn>
  }
  // По умолчанию игрок уже зарегистрирован: иначе каждый позитивный кейс
  // спотыкается об отказ молчаливой регистрации.
  stubs.hasAccount.mockResolvedValue(true)
  return { useCase: new TelegramWebAppLoginUseCase(config, provisioning), signIn: stubs.signIn }
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
      { ip: '1.1.1.1', userAgent: 'Telegram/Android' },
    )

    expect(signIn).toHaveBeenCalledTimes(1)
    const arg = signIn.mock.calls[0]![0] as Record<string, unknown>
    expect(arg['provider']).toBe('telegram')
    expect(arg['providerUserId']).toBe('45367')
    expect(arg['displayName']).toBe('Иван Петров')
    expect(arg['referralCode']).toBe('ABCD2345')
  })

  it('подписанный набор может содержать signature — в check-строке её нет', async () => {
    const { useCase, signIn } = makeUseCase()
    signIn.mockResolvedValue(okSignInResult())

    await useCase.execute({ initData: buildWebAppInitData({ withSignature: true }) })

    expect(signIn).toHaveBeenCalledTimes(1)
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

  /**
   * Молчаливая регистрация запрещена: init_data — предъявительский токен, и
   * ссылка с чужой подписью иначе молча привела бы игрока в чужой кошелёк.
   */
  it('нового игрока не заводит: вход только по уже существующей связке', async () => {
    const signIn = vi.fn()
    const useCase = new TelegramWebAppLoginUseCase(
      new ConfigService({ TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN }),
      { signIn, hasAccount: vi.fn().mockResolvedValue(false) } as never,
    )

    await expect(useCase.execute({ initData: buildWebAppInitData() })).rejects.toBeInstanceOf(
      OAuthExchangeError,
    )
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

  it('auth_date старше 15 минут → OAuthExchangeError', async () => {
    const { useCase } = makeUseCase()
    await expect(
      useCase.execute({ initData: buildWebAppInitData({ auth_date: NOW_SEC - 901 }) }),
    ).rejects.toBeInstanceOf(OAuthExchangeError)
  })

  it('auth_date из будущего → OAuthExchangeError (окно не одностороннее)', async () => {
    const { useCase } = makeUseCase()
    await expect(
      useCase.execute({ initData: buildWebAppInitData({ auth_date: NOW_SEC + 3_600 }) }),
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
      auth_date: String(NOW_SEC),
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

  /**
   * «045367» и «45367 » — тот же игрок для Telegram, но ДРУГАЯ строка в
   * auth_providers(telegram, provider_user_id): появился бы второй
   * беспарольный аккаунт с отдельным кошельком и отдельной реферальной веткой.
   */
  it('id с ведущим нулём или пробелом отвергается, а не заводится вторым', async () => {
    const { useCase, signIn } = makeUseCase()
    signIn.mockResolvedValue(okSignInResult())

    for (const rawId of ['045367', '45367 ', '-1', 'abc', '45367.5']) {
      await expect(
        useCase.execute({ initData: buildWebAppInitData({ user: { id: rawId } }) }),
      ).rejects.toBeInstanceOf(OAuthExchangeError)
    }
    expect(signIn).not.toHaveBeenCalled()
  })
})
