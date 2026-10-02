/**
 * Юнит-тесты AdminAuthGuard (G17/G18): админ-контур отказывает доменными
 * AppError, а не Nest UnauthorizedException.
 *
 * Ключевые инварианты:
 *  - все ветки отказа остаются 401 (фронт логутится по статусу, не по коду);
 *  - доменные отказы verify (подпись/срок) НЕ проглатываются в безликий
 *    «Unauthorized» — раньше catch-all съедал их вместе с проверкой audience;
 *  - нештатная ошибка внутри verify (битый base64, отсутствующий secret) не
 *    уходит в 500 и не раскрывает внутренности клиенту.
 */
import {
  AdminJwtTokenError,
  InvalidAdminCredentialsError,
} from '../src/modules/admin/domain/errors'
import { AdminAuthGuard } from '../src/modules/admin/presentation/admin-auth.guard'

import type { AdminAuthService } from '../src/modules/admin/infrastructure/admin-jwt.service'

const ADMIN_PAYLOAD = { sub: 'a-1', role: 'superadmin', aud: 'admin' }

type GuardOutcome = {
  passed: boolean
  /** Что и сколько раз guard передал в AdminAuthService.verify. */
  verifiedTokens: string[]
  error: unknown
  /** Тот же req, что видел guard: по нему проверяем, что никто не авторизован. */
  requestUser: unknown
}

function runGuard(
  headers: Record<string, string>,
  verify: (token: string) => Record<string, unknown>,
): GuardOutcome {
  const request = { headers, user: undefined as unknown }
  const verifiedTokens: string[] = []
  const adminAuth = {
    verify: (token: string) => {
      verifiedTokens.push(token)
      return verify(token)
    },
  } as unknown as AdminAuthService

  let passed = false
  let error: unknown = null
  try {
    passed = new AdminAuthGuard(adminAuth).canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as never)
  } catch (caught) {
    error = caught
  }
  return { passed, verifiedTokens, error, requestUser: request.user }
}

describe('AdminAuthGuard', () => {
  it('админский токен: проускает и кладёт AdminActor в req.user', () => {
    const out = runGuard({ authorization: 'Bearer admin-jwt' }, () => ADMIN_PAYLOAD)

    expect(out.passed).toBe(true)
    expect(out.error).toBeNull()
    // Bearer-префикс снимается, токен отдаётся сервису как есть
    expect(out.verifiedTokens).toEqual(['admin-jwt'])
    expect(out.requestUser).toEqual({ id: 'a-1', role: 'superadmin', isAdmin: true })
  })

  it('без Authorization → InvalidAdminCredentialsError (401), verify не вызывается', () => {
    const out = runGuard({}, () => ADMIN_PAYLOAD)

    expect(out.error).toBeInstanceOf(InvalidAdminCredentialsError)
    expect((out.error as InvalidAdminCredentialsError).httpStatus).toBe(401)
    expect(out.verifiedTokens).toHaveLength(0)
    expect(out.requestUser).toBeUndefined()
  })

  it('заголовок не Bearer → InvalidAdminCredentialsError (401)', () => {
    const out = runGuard({ authorization: 'Token admin-jwt' }, () => ADMIN_PAYLOAD)
    expect(out.error).toBeInstanceOf(InvalidAdminCredentialsError)
    expect(out.verifiedTokens).toHaveLength(0)
  })

  it('пустой Bearer → InvalidAdminCredentialsError (401)', () => {
    const out = runGuard({ authorization: 'Bearer ' }, () => ADMIN_PAYLOAD)
    expect(out.error).toBeInstanceOf(InvalidAdminCredentialsError)
    expect(out.verifiedTokens).toHaveLength(0)
  })

  it('чужой audience (player-токен в админке) → InvalidAdminCredentialsError (401)', () => {
    const out = runGuard({ authorization: 'Bearer player-jwt' }, () => ({
      ...ADMIN_PAYLOAD,
      aud: 'user',
    }))

    expect(out.error).toBeInstanceOf(InvalidAdminCredentialsError)
    expect((out.error as InvalidAdminCredentialsError).code).toBe('INVALID_ADMIN_CREDENTIALS')
    expect(out.requestUser).toBeUndefined()
  })

  it('aud отсутствует → тот же отказ (обычный игрок не становится админом)', () => {
    const out = runGuard({ authorization: 'Bearer player-jwt' }, () => ({
      sub: 'u-1',
      role: 'user',
    }))
    expect(out.error).toBeInstanceOf(InvalidAdminCredentialsError)
  })

  it('истёкший токен: TOKEN_EXPIRED доходит до клиента, а не «Unauthorized»', () => {
    const out = runGuard({ authorization: 'Bearer admin-jwt' }, () => {
      throw new AdminJwtTokenError('TOKEN_EXPIRED')
    })

    expect(out.error).toBeInstanceOf(AdminJwtTokenError)
    expect((out.error as AdminJwtTokenError).code).toBe('TOKEN_EXPIRED')
    expect((out.error as AdminJwtTokenError).httpStatus).toBe(401)
  })

  it('нештатная ошибка verify (битый base64, отсутствие secret) → INVALID_TOKEN, не 500', () => {
    const out = runGuard({ authorization: 'Bearer admin-jwt' }, () => {
      throw new TypeError('Cannot read properties of undefined (reading split)')
    })

    expect(out.error).toBeInstanceOf(AdminJwtTokenError)
    expect((out.error as AdminJwtTokenError).code).toBe('INVALID_TOKEN')
    expect((out.error as AdminJwtTokenError).httpStatus).toBe(401)
    // внутренности оригинальной ошибки наружу не уезжают
    expect((out.error as Error).message).not.toContain('Cannot read properties')
  })

  it('sub/role не-строки: вход разрешён, но поля пустые (никаких [object Object])', () => {
    const out = runGuard({ authorization: 'Bearer admin-jwt' }, () => ({
      sub: 42,
      role: null,
      aud: 'admin',
    }))

    expect(out.passed).toBe(true)
    expect(out.requestUser).toEqual({ id: '', role: '', isAdmin: true })
  })
})
