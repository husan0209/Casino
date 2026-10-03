/**
 * Юнит-спеки нормализации клиентских отпечатков (инфраструктурный unit).
 *
 * Переехали из `application/use-cases/track-click.use-case.spec.ts` (решение В5):
 * use case больше не знает про свободные функции infrastructure — он получает
 * нормализацию через порт IpFingerprinter. Значит, и тесты этих функций живут
 * рядом с их реализацией, как affiliate-jwt.service.spec.ts. Сами проверки
 * не менялись.
 */
import { describe, expect, it } from 'vitest'

import {
  extractRefererHost,
  IpHasher,
  normalizeIp,
  sanitizeUserAgent,
} from '../infrastructure/ip-hasher'

describe('ip-hasher helpers', () => {
  it('normalises ipv4-mapped ipv6 to plain ipv4 so one client yields one hash', () => {
    expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5')
  })

  it('normalises missing values to an empty string', () => {
    expect(normalizeIp(undefined)).toBe('')
    expect(normalizeIp(null)).toBe('')
  })

  it('truncates an overlong user agent', () => {
    expect(sanitizeUserAgent('x'.repeat(400))?.length).toBe(255)
  })

  it('returns null for an absent user agent', () => {
    expect(sanitizeUserAgent(undefined)).toBeNull()
  })

  it('extracts only the host from a referer, dropping the query', () => {
    expect(extractRefererHost('https://partner.example/promo?token=secret')).toBe('partner.example')
  })

  it('returns null for a malformed referer', () => {
    expect(extractRefererHost('not a url')).toBeNull()
  })
})

/** Порт обязывает реализацию отдавать те же значения, что и свободные функции. */
describe('IpHasher as IpFingerprinter', () => {
  it('delegates the sanitizers so application and persistence cannot diverge', () => {
    const hasher = new IpHasher()

    expect(hasher.sanitizeUserAgent('x'.repeat(400))?.length).toBe(255)
    expect(hasher.sanitizeUserAgent(null)).toBeNull()
    expect(hasher.extractRefererHost('https://partner.example/promo?token=secret')).toBe(
      'partner.example',
    )
    expect(hasher.extractRefererHost(undefined)).toBeNull()
    expect(hasher.hash('::ffff:203.0.113.5')).toBe(hasher.hash('203.0.113.5'))
  })
})
