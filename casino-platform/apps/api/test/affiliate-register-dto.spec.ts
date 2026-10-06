/**
 * Контракт тела POST /affiliate/register (схема + реальный payload клиента).
 *
 * Регистрация партнёра была нерабочей из-за расхождения имён: схема ждала
 * `acceptTerms`, а фронт шлёт `accept_terms` (§2.2 API_CONVENTIONS — тело в
 * snake_case). Юнит-тесты use-case это поймать не могли: они вызывают
 * `RegisterAffiliateUseCase.execute` напрямую, с camelCase-входом, то есть
 * слой presentation в них не участвует вовсе.
 */
import { describe, expect, it } from 'vitest'

import { RegisterAffiliateSchema } from '../src/modules/affiliate/presentation/dto/affiliate.dto'

/** Ровно то тело, которое отправляет apps/web/src/stores/affiliate.ts. */
const WEB_PAYLOAD = {
  email: 'Partner@Example.com',
  password: 'SuperSecret123',
  display_name: undefined,
  website: 'https://partner.example',
  telegram: '@partner',
  accept_terms: true,
}

describe('RegisterAffiliateSchema', () => {
  it('принимает payload фронтенда и нормализует email', () => {
    const parsed = RegisterAffiliateSchema.parse(WEB_PAYLOAD)

    expect(parsed.email).toBe('partner@example.com')
    expect(parsed.accept_terms).toBe(true)
  })

  it('согласие false — человеческое сообщение, а не дефолт zod', () => {
    const res = RegisterAffiliateSchema.safeParse({ ...WEB_PAYLOAD, accept_terms: false })
    if (res.success) {
      throw new Error('ожидался отказ валидации')
    }

    expect(res.error.issues[0]?.message).toBe('Необходимо принять условия партнёрской программы')
  })

  // Именно этот случай и происходил на самом деле: фронт шлёт `accept_terms`,
  // схема ждёт `acceptTerms` → ключ отсутствует.
  it('поля нет вовсе — то же сообщение', () => {
    const payload: Record<string, unknown> = { ...WEB_PAYLOAD }
    delete payload.accept_terms
    const res = RegisterAffiliateSchema.safeParse(payload)
    if (res.success) {
      throw new Error('ожидался отказ валидации')
    }

    expect(res.error.issues[0]?.path).toEqual(['accept_terms'])
    expect(res.error.issues[0]?.message).toBe('Необходимо принять условия партнёрской программы')
  })

  it('camelCase-вариант принят не будет: тело обязано быть snake_case', () => {
    const res = RegisterAffiliateSchema.safeParse({
      email: 'p@example.com',
      password: 'SuperSecret123',
      acceptTerms: true,
    })

    expect(res.success).toBe(false)
  })
})
