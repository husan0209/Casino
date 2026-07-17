export type UserId = string

export type UserStatus = 'active' | 'blocked' | 'suspended'
export type UserRole = 'user' | 'admin' | 'superadmin'

export interface UserProps {
  id: UserId
  email: string | null
  emailVerified: boolean
  username: string | null
  passwordHash: string | null
  status: UserStatus
  role: UserRole
  referralCode: string
  referredBy: UserId | null
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
}

export class UserEntity {
  constructor(private props: UserProps) {}

  static create(data: Omit<UserProps, 'id' | 'createdAt' | 'updatedAt' | 'lastLoginAt' | 'emailVerified' | 'status' | 'role'> & Partial<Pick<UserProps,'emailVerified'|'status'|'role'>>): UserEntity {
    const now = new Date()
    return new UserEntity({
      ...data,
      id: '' as UserId,
      emailVerified: data.emailVerified ?? false,
      status: data.status ?? 'active',
      role: data.role ?? 'user',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    })
  }

  get id() { return this.props.id }
  get email() { return this.props.email }
  get emailVerified() { return this.props.emailVerified }
  get passwordHash() { return this.props.passwordHash }
  get status() { return this.props.status }
  get role() { return this.props.role }
  get referralCode() { return this.props.referralCode }
  get referredBy() { return this.props.referredBy }

  markEmailVerified() { this.props.emailVerified = true; this.props.updatedAt = new Date() }
  markLogin() { this.props.lastLoginAt = new Date() }
  block() { this.props.status = 'blocked'; this.props.updatedAt = new Date() }
  unblock() { this.props.status = 'active'; this.props.updatedAt = new Date() }
  setPasswordHash(hash: string) { this.props.passwordHash = hash; this.props.updatedAt = new Date() }

  toJSON(): UserProps { return { ...this.props } }
}
