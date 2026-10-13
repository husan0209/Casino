/**
 * Юнит-тесты проверки ID-токена Google (GOOGLE_ID_TOKEN_VERIFIER).
 *
 * Криптография настоящая: генерируем RSA-пару, публикуем публичный ключ как JWKS
 * и подписываем токены приватным ключом. Подделка обязана отбиваться на каждом
 * пункте: подпись, алгоритм, издатель, получатель, срок, подтверждение почты,
 * неизвестный kid. Единственный внешний вызов клиента — fetch за JWKS, он мокан.
 */
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'crypto'

import { ConfigService } from '@nestjs/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GoogleIdTokenVerifierService } from '../src/modules/auth/infrastructure/services/google-id-token.verifier.service'

const CLIENT_ID = '1234567890-abcd.apps.googleusercontent.com'
const KID = 'key-a'

function makeRsa(): { key: KeyObject; jwk: Record<string, string> } {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const material = pair.publicKey.export({ format: 'jwk' }) as Record<string, string>
  return { key: pair.privateKey, jwk: { ...material, kid: KID, alg: 'RS256' } }
}

const primary = makeRsa()

const b64url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

function makeToken(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT', kid: KID },
  key: KeyObject = primary.key,
): string {
  const head = b64url(JSON.stringify(header))
  const body = b64url(JSON.stringify(claims))
  const signature = cryptoSign('sha256', Buffer.from(`${head}.${body}`, 'ascii'), key)
  return `${head}.${body}.${signature.toString('base64url')}`
}

function validClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-user-1',
    email: 'Ivan@Example.com',
    email_verified: true,
    name: 'Иван Пример',
    nonce: 'nonce-value',
    iat: now,
    exp: now + 3600,
    ...over,
  }
}

function stubJwks(keys: unknown[], cacheControl = 'public, max-age=3600'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'cache-control': cacheControl }),
      json: async () => ({ keys }),
    }),
  )
}

function makeVerifier(
  values: Record<string, string> = { GOOGLE_CLIENT_ID: CLIENT_ID },
): GoogleIdTokenVerifierService {
  const config = new ConfigService()
  vi.spyOn(config, 'get').mockImplementation((key: string) => values[key])
  return new GoogleIdTokenVerifierService(config)
}

beforeEach(() => {
  stubJwks([primary.jwk])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GoogleIdTokenVerifierService', () => {
  it('возвращает claims корректно подписанного токена', async () => {
    const claims = await makeVerifier().verify(makeToken(validClaims()))

    expect(claims.subject).toBe('google-user-1')
    expect(claims.email).toBe('Ivan@Example.com')
    expect(claims.name).toBe('Иван Пример')
    expect(claims.nonce).toBe('nonce-value')
  })

  it('принимает оба разрешённых значения iss', async () => {
    const verifier = makeVerifier()

    await expect(
      verifier.verify(makeToken(validClaims({ iss: 'accounts.google.com' }))),
    ).resolves.toMatchObject({ subject: 'google-user-1' })
    await expect(
      verifier.verify(makeToken(validClaims({ iss: 'https://accounts.google.com' }))),
    ).resolves.toBeTruthy()
  })

  it('отбивает подделку: payload изменён, подпись осталась старой', async () => {
    const token = makeToken(validClaims())
    const [head, , sig] = token.split('.')
    const forged = b64url(
      JSON.stringify({ ...validClaims(), sub: 'chuzhoy', email: 'attacker@evil.test' }),
    )

    await expect(makeVerifier().verify(`${head}.${forged}.${sig}`)).rejects.toThrow(/подпись/)
  })

  it('отбивает токен, подписанный чужим ключом', async () => {
    const rogue = makeRsa()

    await expect(
      makeVerifier().verify(makeToken(validClaims(), { alg: 'RS256', kid: KID }, rogue.key)),
    ).rejects.toThrow(/подпись/)
  })

  it('отбивает alg:none и другой алгоритм в заголовке', async () => {
    const verifier = makeVerifier()

    await expect(
      verifier.verify(makeToken(validClaims(), { alg: 'none', kid: KID })),
    ).rejects.toThrow(/алгоритм/)
    await expect(
      verifier.verify(makeToken(validClaims(), { alg: 'HS256', kid: KID })),
    ).rejects.toThrow(/алгоритм/)
  })

  it('отбивает токен без kid', async () => {
    await expect(makeVerifier().verify(makeToken(validClaims(), { alg: 'RS256' }))).rejects.toThrow(
      /kid/,
    )
  })

  it('отбивает чужого получателя, просрочку, слишком старый и будущий iat', async () => {
    const now = Math.floor(Date.now() / 1000)
    const verifier = makeVerifier()

    await expect(
      verifier.verify(makeToken(validClaims({ aud: 'chuzhoi-client' }))),
    ).rejects.toThrow(/получатель/)
    // запас на часовые скрейды — 60 с, поэтому «просрочен» начинается за его пределами
    await expect(verifier.verify(makeToken(validClaims({ exp: now - 120 })))).rejects.toThrow(
      /просрочен/,
    )
    await expect(
      verifier.verify(makeToken(validClaims({ iat: now - 11 * 60, exp: now + 3600 }))),
    ).rejects.toThrow(/устарел/)
    await expect(
      verifier.verify(makeToken(validClaims({ iat: now + 600, exp: now + 3600 }))),
    ).rejects.toThrow(/будущем/)
  })

  it('не принимает неподтверждённую или отсутствующую почту и пустой sub', async () => {
    const verifier = makeVerifier()

    await expect(
      verifier.verify(makeToken(validClaims({ email_verified: false }))),
    ).rejects.toThrow(/почта/)
    await expect(
      verifier.verify(makeToken(validClaims({ email: undefined, email_verified: undefined }))),
    ).rejects.toThrow(/почта/)
    await expect(verifier.verify(makeToken(validClaims({ sub: '' })))).rejects.toThrow(/субъект/)
  })

  it('iss массивом и не-каноничный base64url отбиваются', async () => {
    const verifier = makeVerifier()

    // String(['https://accounts.google.com']) совпал бы с допустимым значением,
    // поэтому издатель сверяется только у строки.
    await expect(
      verifier.verify(makeToken(validClaims({ iss: ['https://accounts.google.com'] }))),
    ).rejects.toThrow(/издатель/)

    // Сегменты обязаны быть в алфавите base64url: иначе у одного токена много
    // строковых форм (`+` вместо `-`, padding, мусор), и дедуп по строке врёт.
    await expect(verifier.verify('ab+cd.ef==.gh/ij')).rejects.toThrow(/структура/)
    await expect(verifier.verify('abc=.def.ghi')).rejects.toThrow(/структура/)
  })

  it('не принимает мусор вместо JWT', async () => {
    const verifier = makeVerifier()

    await expect(verifier.verify('abc')).rejects.toThrow(/структура/)
    await expect(verifier.verify('a.b.c')).rejects.toThrow(/сегмент/)
  })

  it('без GOOGLE_CLIENT_ID не угадывает aud, а падает', async () => {
    await expect(makeVerifier({}).verify(makeToken(validClaims()))).rejects.toThrow(/не настроен/)
  })

  it('переиспользует скачанные ключи между входами', async () => {
    const verifier = makeVerifier()

    await verifier.verify(makeToken(validClaims()))
    await verifier.verify(makeToken(validClaims({ sub: 'google-user-2' })))

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('неизвестный kid (ротация ключа Google) обновляет JWKS, но не чаще раза в минуту', async () => {
    // Часы нужны: частота вынужденных загрузок меряется интервалом, а не списком
    // виденных kid.
    vi.useFakeTimers()
    try {
      const verifier = makeVerifier()
      await verifier.verify(makeToken(validClaims()))

      const second = makeRsa()
      const rotatedJwk = { ...second.jwk, kid: 'key-b' }
      stubJwks([primary.jwk, rotatedJwk])
      // Новый мок = свой счётчик обращений: считаем загрузку после ротации отдельно.
      const fetchAfterRotation = vi.mocked(fetch)
      const token = makeToken(
        validClaims({ sub: 'google-user-3' }),
        { alg: 'RS256', kid: 'key-b' },
        second.key,
      )

      await expect(verifier.verify(token)).resolves.toMatchObject({ subject: 'google-user-3' })
      expect(fetchAfterRotation).toHaveBeenCalledTimes(1)

      // Второй незнакомый kid в том же окне — не повод стучаться к Google: иначе
      // поток токенов с выдуманными kid стоит поток обращений.
      await expect(
        verifier.verify(makeToken(validClaims(), { alg: 'RS256', kid: 'key-zzz' })),
      ).rejects.toThrow(/неизвестный ключ/)
      expect(fetchAfterRotation).toHaveBeenCalledTimes(1)

      // За пределами интервала грузим снова: ротация ключей не запирает вход навсегда.
      vi.advanceTimersByTime(61_000)
      await expect(
        verifier.verify(makeToken(validClaims(), { alg: 'RS256', kid: 'key-zzz' })),
      ).rejects.toThrow(/неизвестный ключ/)
      expect(fetchAfterRotation).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('сбой загрузки JWKS при пустом кеше — отказ, а не доверие без проверки', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(makeVerifier().verify(makeToken(validClaims()))).rejects.toThrow(
      /ключи Google недоступны/,
    )
  })

  it('после сбоя JWKS не повторяем обращение к Google на каждый токен', async () => {
    // Без паузы поток токенов при недоступном JWKS (или с истёкшим кешем) означал
    // бы по HTTP-вызову с 10-секундным таймаутом на каждый вход.
    const failing = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', failing)
    const verifier = makeVerifier()

    await expect(verifier.verify(makeToken(validClaims()))).rejects.toThrow(/ключ/)
    await expect(verifier.verify(makeToken(validClaims({ sub: 'google-user-2' })))).rejects.toThrow(
      /ключ/,
    )

    expect(failing).toHaveBeenCalledTimes(1)
  })

  it('токен с `nbf` из будущего отклоняется', async () => {
    const now = Math.floor(Date.now() / 1000)

    await expect(
      makeVerifier().verify(makeToken(validClaims({ nbf: now + 600, exp: now + 3600 }))),
    ).rejects.toThrow(/не действует/)
  })
})
