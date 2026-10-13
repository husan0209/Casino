/**
 * Юнит-тесты GoogleOneTapUseCase (G21) — привязка credential к браузеру.
 *
 * Криптографию токена проверяет google-id-token-verifier.spec.ts; здесь предмет
 * другой: nonce. Он подписан нашим сервером, лежит в httpOnly-куке и обязан
 * совпасть со значением внутри токена. Именно это не даёт предъявить чужой
 * (или украденный) ID-токен в своём браузере и получить чужую сессию.
 */
import { createHmac } from 'crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  OAuthNotConfiguredError,
  OAuthStateError,
  OAuthTokenInvalidError,
} from '@modules/auth/domain/errors'

import { GoogleOneTapUseCase } from '../src/modules/auth/application/use-cases/oauth/google-one-tap.use-case'

import type { IGoogleIdTokenVerifier } from '../src/modules/auth/domain/auth.ports'

const SECRET = 'a'.repeat(64)
const NONCE = 'nonce-from-google-prompt'
/** Контекст вывода ключа — как в use-case: у nonce и у `state` подписи несовместимы. */
const NONCE_KEY_CONTEXT = 'google-one-tap-nonce'

function nonceKey(secret: string): string {
  return createHmac('sha256', secret).update(NONCE_KEY_CONTEXT).digest('base64url')
}

interface ProvisionCall {
  provider: string
  providerUserId: string
  email?: string | null
  displayName?: string | undefined
  referralCode?: string | undefined
  ip?: string | undefined
  userAgent?: string | undefined
}

function makeDeps(args: {
  claims?: Record<string, unknown> | null
  provisioningError?: Error
  /**
   * Прочитать nonce в момент проверки, а не при сборке зависимостей: так тест
   * может сверить значение, выданное `issueNonce()` уже после создания use-case.
   */
  nonceAtVerify?: () => string
}): {
  uc: GoogleOneTapUseCase
  calls: ProvisionCall[]
  cookie: string
} {
  const calls: ProvisionCall[] = []
  const config = {
    get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? SECRET : undefined),
  } as never
  const verifier = {
    verify: async () => {
      if (args.claims === null) {
        throw new OAuthTokenInvalidError('подпись')
      }
      return (
        args.claims ?? {
          subject: 'g-1',
          email: 'ivan@example.com',
          nonce: args.nonceAtVerify?.() ?? NONCE,
        }
      )
    },
  } as unknown as IGoogleIdTokenVerifier
  const provisioning = {
    signIn: async (input: ProvisionCall) => {
      if (args.provisioningError) {
        throw args.provisioningError
      }
      calls.push(input)
      return { accessToken: 'jwt', refreshToken: 'r', user: { id: 'u1' }, wasLinked: false }
    },
  } as never

  const uc = new GoogleOneTapUseCase(config, verifier, provisioning)
  // Кука с тем же nonce, что вернёт фейковый верификатор: пару «выдано ↔ принято»
  // собираем здесь, а не через issueNonce (его формат проверяется отдельным кейсом).
  return { uc, calls, cookie: cookieWithNonce(NONCE) }
}

/** Собрать значение куки так, как это делает сервер: base64url(JSON) + HMAC-подпись. */
function cookieWithNonce(
  nonce: string,
  secret = SECRET,
  issuedAt = Date.now(),
  purpose = 'otn',
): string {
  const body = Buffer.from(JSON.stringify({ p: purpose, t: issuedAt, n: nonce })).toString(
    'base64url',
  )
  return `${body}.${createHmac('sha256', nonceKey(secret)).update(body).digest('base64url')}`
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GoogleOneTapUseCase', () => {
  it('issueNonce отдаёт клиенту значение, а в куку — подписанный конверт', () => {
    const { uc } = makeDeps({})

    const issued = uc.issueNonce()
    const [body, signature] = issued.cookie.split('.')

    // Клиенту и Google достается только случайное значение: по нему нельзя
    // восстановить конверт куки, а значит нельзя и подложить ожидаемый nonce
    // в другом браузере.
    expect(issued.cookie).not.toContain(issued.value)
    expect(signature).toHaveLength(43)
    expect(body).toBeDefined()
    expect(
      createHmac('sha256', nonceKey(SECRET))
        .update(body ?? '')
        .digest('base64url'),
    ).toBe(signature)
    const payload = JSON.parse(Buffer.from(body ?? '', 'base64url').toString()) as {
      t: number
      n: string
    }
    expect(payload.t).toBe(Date.now())
    expect(payload.n).toBe(issued.value)
    expect(payload.n.length).toBeGreaterThanOrEqual(22)
  })

  it('выданный nonce проходит обмен: значение из тела и кука из одного вызова', async () => {
    // Пара «что отдали браузеру ↔ что ждём в куке» — единственный шов, который
    // не виден ни в юните верификатора, ни в http-тесте маршрута: там и там
    // вторая половина подменена. Разъезд формы (значение vs конверт) молча
    // ломает весь поток на отказ, поэтому проверяем именно пару.
    const issuedRef: { current: { value: string; cookie: string } | null } = { current: null }
    const { uc, calls } = makeDeps({ nonceAtVerify: (): string => issuedRef.current?.value ?? '' })

    const issued = uc.issueNonce()
    issuedRef.current = issued
    const result = await uc.execute({
      credential: 'jwt-from-google',
      nonceCookie: issued.cookie,
    })

    expect(result.accessToken).toBe('jwt')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ provider: 'google', providerUserId: 'g-1' })
  })

  it('обменивает credential на сессию провайдера с теми же полями, что и code flow', async () => {
    const { uc, calls, cookie } = makeDeps({})

    const result = await uc.execute({
      credential: 'jwt-from-google',
      nonceCookie: cookie,
      referralCode: 'REF9',
      ip: '203.0.113.7',
      userAgent: 'Chrome',
    })

    expect(result.accessToken).toBe('jwt')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      provider: 'google',
      providerUserId: 'g-1',
      email: 'ivan@example.com',
      referralCode: 'REF9',
      ip: '203.0.113.7',
      userAgent: 'Chrome',
    })
  })

  it('без куки nonce вход не проходит', async () => {
    const { uc, calls } = makeDeps({})

    await expect(uc.execute({ credential: 'jwt' })).rejects.toThrow(OAuthStateError)
    expect(calls).toHaveLength(0)
  })

  it('кука с чужой подписью отклоняется', async () => {
    const { uc } = makeDeps({})

    await expect(
      uc.execute({ credential: 'jwt', nonceCookie: cookieWithNonce(NONCE, 'b'.repeat(64)) }),
    ).rejects.toThrow(OAuthStateError)
  })

  it('просроченная кука nonce отклоняется', async () => {
    const { uc } = makeDeps({})
    const stale = cookieWithNonce(NONCE, SECRET, Date.now() - 11 * 60 * 1000)

    await expect(uc.execute({ credential: 'jwt', nonceCookie: stale })).rejects.toThrow(
      OAuthStateError,
    )
  })

  it('чужое назначение в подписанном теле отклоняется', async () => {
    const { uc } = makeDeps({})
    // Подпись настоящая (тот же выведенный ключ), форма та же — отличается только
    // метка назначения: её проверяем отдельно от ключа.
    const body = Buffer.from(JSON.stringify({ p: 'ocs', t: Date.now(), n: NONCE })).toString(
      'base64url',
    )
    const asState = `${body}.${createHmac('sha256', nonceKey(SECRET)).update(body).digest('base64url')}`

    await expect(uc.execute({ credential: 'jwt', nonceCookie: asState })).rejects.toThrow(
      OAuthStateError,
    )
  })

  it('значение из будущего (дальше часового скрейда) отклоняется', async () => {
    const { uc } = makeDeps({})
    const future = cookieWithNonce(NONCE, SECRET, Date.now() + 10 * 60 * 1000)

    await expect(uc.execute({ credential: 'jwt', nonceCookie: future })).rejects.toThrow(
      OAuthStateError,
    )
  })

  it('мусор вместо куки и кука без тела отклоняются', async () => {
    const { uc } = makeDeps({})

    await expect(uc.execute({ credential: 'jwt', nonceCookie: 'abc' })).rejects.toThrow(
      OAuthStateError,
    )
    await expect(uc.execute({ credential: 'jwt', nonceCookie: '.sig' })).rejects.toThrow(
      OAuthStateError,
    )
    await expect(
      uc.execute({
        credential: 'jwt',
        nonceCookie: `${Buffer.from('не json').toString('base64url')}.x`,
      }),
    ).rejects.toThrow(OAuthStateError)
  })

  it('nonce из токена обязан совпасть с выданным', async () => {
    const { uc, calls } = makeDeps({
      claims: { subject: 'g-1', email: 'e@x.io', nonce: 'chuzhoi' },
    })

    await expect(
      uc.execute({ credential: 'jwt', nonceCookie: cookieWithNonce(NONCE) }),
    ).rejects.toThrow(OAuthTokenInvalidError)
    expect(calls).toHaveLength(0)
  })

  it('токен вообще без nonce отвергается', async () => {
    const { uc } = makeDeps({ claims: { subject: 'g-1', email: 'e@x.io' } })

    await expect(
      uc.execute({ credential: 'jwt', nonceCookie: cookieWithNonce(NONCE) }),
    ).rejects.toThrow(OAuthTokenInvalidError)
  })

  it('не ругаемся на пустой JWT_ACCESS_SECRET: подпись на пустом ключе — не подпись', async () => {
    const config = { get: () => undefined } as never
    const uc = new GoogleOneTapUseCase(
      config,
      {
        verify: async () => ({ subject: 'g', email: 'e@x.io', nonce: 'n' }),
      } as unknown as IGoogleIdTokenVerifier,
      {} as never,
    )

    expect(() => uc.issueNonce()).toThrow(OAuthNotConfiguredError)
  })

  it('отказ верификатора не доходит до провижининга', async () => {
    const { uc, calls } = makeDeps({ claims: null })

    await expect(
      uc.execute({ credential: 'jwt', nonceCookie: cookieWithNonce(NONCE) }),
    ).rejects.toThrow(OAuthTokenInvalidError)
    expect(calls).toHaveLength(0)
  })
})
