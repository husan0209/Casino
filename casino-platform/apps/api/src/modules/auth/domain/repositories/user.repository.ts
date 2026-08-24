import { User } from '../entities/user.entity'

export interface CreateUserInput {
  /** null для OAuth-пользователей (вход через провайдера, пароля нет) */
  passwordHash: string | null
  email: string | null
  referralCode: string
  referredBy?: string | null
}

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>
  findById(id: string): Promise<User | null>
  findByReferralCode(code: string): Promise<User | null>
  referralCodeExists(code: string): Promise<boolean>
  create(input: CreateUserInput): Promise<User>
  update(user: User): Promise<void>
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY')
