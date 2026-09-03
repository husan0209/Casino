export type UserStatus = 'active' | 'blocked' | 'suspended'
export type UserRole = 'user' | 'admin' | 'superadmin'

export interface UserProps {
  id: string
  email: string | null
  username: string | null
  passwordHash: string | null
  status: UserStatus
  role: UserRole
  emailVerified: boolean
  referralCode: string
  referredBy: string | null
  lastLoginAt: Date | null
  createdAt: Date
  failedLoginAttempts: number
  lastFailedAt: Date | null
  lockedUntil: Date | null
}

export interface LockoutConfig {
  /** Максимум неудачных попыток в окне до блокировки. */
  maxAttempts: number
  /** Скользящее окно подсчёта неудач, мс. */
  windowMs: number
  /** Длительность блокировки, мс. */
  lockDurationMs: number
}

export class User {
  constructor(public readonly props: UserProps) {}

  static fromPrisma(row: {
    id: string
    email: string | null
    username: string | null
    passwordHash: string | null
    status: UserStatus
    role: UserRole
    emailVerified: boolean
    referralCode: string
    referredBy: string | null
    lastLoginAt: Date | null
    createdAt: Date
    failedLoginAttempts: number
    lastFailedAt: Date | null
    lockedUntil: Date | null
  }): User {
    return new User({ ...row })
  }

  get id(): string {
    return this.props.id
  }
  get email(): string | null {
    return this.props.email
  }
  get username(): string | null {
    return this.props.username
  }
  get passwordHash(): string | null {
    return this.props.passwordHash
  }
  get status(): UserStatus {
    return this.props.status
  }
  get role(): UserRole {
    return this.props.role
  }
  get emailVerified(): boolean {
    return this.props.emailVerified
  }
  get referralCode(): string {
    return this.props.referralCode
  }
  get referredBy(): string | null {
    return this.props.referredBy
  }

  markLogin(): void {
    this.props.lastLoginAt = new Date()
  }

  /** Аккаунт заблокирован, если lockedUntil ещё в будущем. */
  isLocked(now: Date): boolean {
    return this.props.lockedUntil !== null && this.props.lockedUntil.getTime() > now.getTime()
  }

  /**
   * Зафиксировать неудачную попытку. Скользящее окно: если прошлая неудача
   * старше windowMs, счётчик начинается заново. При достижении maxAttempts —
   * блокировка на lockDurationMs и сброс счётчика (после разблокировки даётся
   * полный новый бюджет попыток).
   */
  registerFailedAttempt(cfg: LockoutConfig, now: Date): void {
    const withinWindow =
      this.props.lastFailedAt !== null &&
      now.getTime() - this.props.lastFailedAt.getTime() <= cfg.windowMs
    this.props.failedLoginAttempts = withinWindow ? this.props.failedLoginAttempts + 1 : 1
    this.props.lastFailedAt = now
    if (this.props.failedLoginAttempts >= cfg.maxAttempts) {
      this.props.lockedUntil = new Date(now.getTime() + cfg.lockDurationMs)
      this.props.failedLoginAttempts = 0
    }
  }

  /** Успешный вход (или админский разблок) — чистое состояние. */
  resetFailedAttempts(): void {
    this.props.failedLoginAttempts = 0
    this.props.lastFailedAt = null
    this.props.lockedUntil = null
  }
  markEmailVerified(): void {
    this.props.emailVerified = true
  }
  setPasswordHash(hash: string): void {
    this.props.passwordHash = hash
  }
}
