import { User, type UserProps } from '../src/modules/auth/domain/entities/user.entity'

const CFG = { maxAttempts: 3, windowMs: 15 * 60_000, lockDurationMs: 30 * 60_000 }

function makeUser(overrides: Partial<UserProps> = {}): User {
  const props: UserProps = {
    id: 'u1',
    email: 'user@example.com',
    username: null,
    passwordHash: 'hash',
    status: 'active',
    role: 'user',
    emailVerified: true,
    referralCode: 'REF1',
    referredBy: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    failedLoginAttempts: 0,
    lastFailedAt: null,
    lockedUntil: null,
    ...overrides,
  }
  return new User(props)
}

describe('GAP-18 account lockout', () => {
  it('считает неудачи внутри окна и не блокирует до лимита', () => {
    const u = makeUser()
    const t0 = new Date('2026-01-01T12:00:00Z')
    u.registerFailedAttempt(CFG, t0)
    u.registerFailedAttempt(CFG, new Date(t0.getTime() + 60_000))
    expect(u.props.failedLoginAttempts).toBe(2)
    expect(u.isLocked(new Date(t0.getTime() + 120_000))).toBe(false)
  })

  it('блокирует на lockDuration при достижении maxAttempts и сбрасывает счётчик', () => {
    const u = makeUser()
    const t0 = new Date('2026-01-01T12:00:00Z')
    u.registerFailedAttempt(CFG, t0)
    u.registerFailedAttempt(CFG, new Date(t0.getTime() + 1_000))
    u.registerFailedAttempt(CFG, new Date(t0.getTime() + 2_000)) // 3-я → лок
    expect(u.props.failedLoginAttempts).toBe(0)
    expect(u.props.lockedUntil).not.toBeNull()
    expect(u.isLocked(new Date(t0.getTime() + 3_000))).toBe(true)
    // блокировка ровно на lockDurationMs
    expect((u.props.lockedUntil as Date).getTime()).toBe(t0.getTime() + 2_000 + CFG.lockDurationMs)
  })

  it('lock истекает через lockDurationMs', () => {
    const u = makeUser({ lockedUntil: new Date('2026-01-01T12:30:00Z') })
    expect(u.isLocked(new Date('2026-01-01T12:29:59Z'))).toBe(true)
    expect(u.isLocked(new Date('2026-01-01T12:30:01Z'))).toBe(false)
  })

  it('за окном счётчик начинается заново (не накапливается вечно)', () => {
    const u = makeUser({ failedLoginAttempts: 2, lastFailedAt: new Date('2026-01-01T12:00:00Z') })
    // следующая попытка через 20 минут (> windowMs 15 мин)
    u.registerFailedAttempt(CFG, new Date('2026-01-01T12:20:00Z'))
    expect(u.props.failedLoginAttempts).toBe(1)
  })

  it('успешный вход сбрасывает всё состояние lockout', () => {
    const u = makeUser({
      failedLoginAttempts: 2,
      lastFailedAt: new Date('2026-01-01T12:00:00Z'),
      lockedUntil: new Date('2026-01-01T12:30:00Z'),
    })
    u.resetFailedAttempts()
    expect(u.props.failedLoginAttempts).toBe(0)
    expect(u.props.lastFailedAt).toBeNull()
    expect(u.props.lockedUntil).toBeNull()
    expect(u.isLocked(new Date('2026-01-01T12:00:01Z'))).toBe(false)
  })
})
