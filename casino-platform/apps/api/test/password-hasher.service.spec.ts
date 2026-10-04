import * as argon2 from 'argon2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PasswordHasher } from '../src/modules/auth/infrastructure/services/password-hasher.service'

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(async () => 'argon2id:hash'),
  verify: vi.fn(async () => true),
}))

/**
 * Парольные параметры — часть контракта безопасности, а не детали реализации.
 *
 * Ошибиться здесь тихо легко: достаточно одному месту написать `argon2i` или
 * уронить `memoryCost` до 1024, чтобы все новые пароли стали перебирать в
 * сотни раз дешевле, — тесты аутентификации это не заметят (мок всегда
 * `true`) и typecheck тоже. Поэтому проверяются ровно те четыре числа, что
 * зафиксированы для платформы, и что verify делегирует argon2 без своей логики.
 */
describe('PasswordHasher', () => {
  beforeEach(() => {
    vi.mocked(argon2.hash).mockClear()
    vi.mocked(argon2.verify).mockClear()
  })

  it('argon2id, 64 MiB, 3 прохода, параллелизм 4', async () => {
    const hasher = new PasswordHasher()

    await expect(hasher.hash('p@ssw0rd')).resolves.toBe('argon2id:hash')

    expect(argon2.hash).toHaveBeenCalledWith('p@ssw0rd', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    })
  })

  it('пароль передаётся как есть, без нормализации и обрезки', async () => {
    const hasher = new PasswordHasher()
    const long = 'x'.repeat(200)

    await hasher.hash(long)

    expect(argon2.hash.mock.calls[0]?.[0]).toBe(long)
  })

  it('verify делегирует argon2.verify (hash, plain) и ничего не добавляет', async () => {
    const hasher = new PasswordHasher()

    await expect(hasher.verify('argon2id:hash', 'p@ssw0rd')).resolves.toBe(true)

    expect(argon2.verify).toHaveBeenCalledWith('argon2id:hash', 'p@ssw0rd')
  })

  it('ошибка argon2 наружу не глотается (мок вернул throw)', async () => {
    const hasher = new PasswordHasher()
    vi.mocked(argon2.verify).mockRejectedValueOnce(new Error('malformed hash'))

    await expect(hasher.verify('мусор', 'p@ssw0rd')).rejects.toThrow('malformed hash')
  })
})
