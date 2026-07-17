import { UserEntity } from '../entities/user.entity'

export interface IUserRepository {
  findById(id: string): Promise<UserEntity | null>
  findByEmail(email: string): Promise<UserEntity | null>
  findByReferralCode(code: string): Promise<UserEntity | null>
  existsByEmail(email: string): Promise<boolean>
  save(user: UserEntity): Promise<UserEntity>
  update(user: UserEntity): Promise<UserEntity>
}
export const USER_REPOSITORY = Symbol('USER_REPOSITORY')
