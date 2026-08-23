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
}

export class User {
  constructor(public readonly props: UserProps) {}

  static fromPrisma(row: {
    id: string; email: string | null; username: string | null; passwordHash: string | null;
    status: UserStatus; role: UserRole; emailVerified: boolean; referralCode: string;
    referredBy: string | null; lastLoginAt: Date | null; createdAt: Date
  }): User {
    return new User({ ...row })
  }

  get id() { return this.props.id }
  get email() { return this.props.email }
  get username() { return this.props.username }
  get passwordHash() { return this.props.passwordHash }
  get status() { return this.props.status }
  get role() { return this.props.role }
  get emailVerified() { return this.props.emailVerified }
  get referralCode() { return this.props.referralCode }
  get referredBy() { return this.props.referredBy }

  markLogin() { this.props.lastLoginAt = new Date() }
  markEmailVerified() { this.props.emailVerified = true }
  setPasswordHash(hash: string) { this.props.passwordHash = hash }
}
