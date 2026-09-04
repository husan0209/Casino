import { describe, expect, it } from 'vitest'

/**
 * GAP-44: smoke-тесты для error-helpers в web-клиенте.
 * Контракт (apps/web/src/lib/api.ts):
 *   - errText: извлекает текст из envelope {error.message} → {message} → Error.message → 'Ошибка';
 *   - errCode: извлекает код из envelope {error.code} (для branch-логики).
 *
 * AxiosError кастуем через `unknown`, чтобы не зависеть от служебных полей
 * (toJSON и пр.) — для теста хватает response.data, который и читают helpers.
 */
import { errCode, errText, type ApiResponse } from '../src/lib/api'

interface FakeAxiosError {
  isAxiosError: true
  name: string
  message: string
  response: { data: Partial<ApiResponse<unknown>>; status: number }
}

function axiosError(data: Partial<ApiResponse<unknown>>, status = 422): unknown {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: 'Request failed',
    response: { data, status },
  } satisfies FakeAxiosError
}

describe('GAP-44 errText', () => {
  it('извлекает error.message из envelope (приоритет 1)', () => {
    const e = axiosError({ error: { message: 'Недостаточно средств' } })
    expect(errText(e)).toBe('Недостаточно средств')
  })

  it('фолбэк на message (приоритет 2)', () => {
    const e = axiosError({ message: 'Просто сообщение' })
    expect(errText(e)).toBe('Просто сообщение')
  })

  it('фолбэк на Error.message для не-axios ошибок', () => {
    expect(errText(new Error('boom'))).toBe('boom')
    expect(errText(new TypeError('x is not a function'))).toBe('x is not a function')
  })

  it('фолбэк на "Ошибка" для unknown без сообщения', () => {
    expect(errText(null)).toBe('Ошибка')
    expect(errText(undefined)).toBe('Ошибка')
    expect(errText({})).toBe('Ошибка')
  })

  it('error.message выигрывает у message при обоих заданных', () => {
    const e = axiosError({ error: { message: 'важное' }, message: 'общее' })
    expect(errText(e)).toBe('важное')
  })
})

describe('GAP-44 errCode', () => {
  it('извлекает error.code для branch-логики (напр. INSUFFICIENT_FUNDS)', () => {
    const e = axiosError({ error: { code: 'INSUFFICIENT_FUNDS', message: 'fail' } })
    expect(errCode(e)).toBe('INSUFFICIENT_FUNDS')
  })

  it('undefined если envelope без error.code', () => {
    const e = axiosError({ error: { message: 'fail' } })
    expect(errCode(e)).toBeUndefined()
  })

  it('undefined для не-axios ошибок', () => {
    expect(errCode(new Error('x'))).toBeUndefined()
    expect(errCode(null)).toBeUndefined()
  })
})
