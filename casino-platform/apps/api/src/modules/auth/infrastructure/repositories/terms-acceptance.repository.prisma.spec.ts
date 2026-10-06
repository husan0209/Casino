import { describe, expect, it } from 'vitest'

import { fingerprintIp } from './terms-acceptance.repository.prisma'

/**
 * GAP-71: Terms §4 обещает «IP-адрес в необратимом виде». Значит в БД не должен
 * попадать сырой адрес — это единственное, что отличает журнал от таблицы, где
 * лежат персональные данные игроков. Спека держит именно это свойство.
 */
describe('fingerprintIp', () => {
  it('не возвращает сырой адрес и детерминирована', () => {
    const ip = '203.0.113.9'
    const hash = fingerprintIp(ip)

    expect(hash).not.toContain(ip)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprintIp(ip)).toBe(hash)
  })

  it('разные адреса дают разные отпечатки', () => {
    expect(fingerprintIp('203.0.113.9')).not.toBe(fingerprintIp('203.0.113.10'))
  })

  it('адреса IPv6 тоже умещаются в поле VARCHAR(64)', () => {
    expect(fingerprintIp('2001:db8::1')).toHaveLength(64)
  })

  it('отсутствие адреса — отдельный детерминированный отпечаток, а не NULL', () => {
    expect(fingerprintIp(null)).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprintIp(null)).toBe(fingerprintIp(null))
    expect(fingerprintIp(null)).not.toBe(fingerprintIp(''))
  })
})
