import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import { User } from '../../domain/entities/user.entity'
import {
  type CreateUserInput,
  type IUserRepository,
} from '../../domain/repositories/user.repository'

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  private toDomain(row: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>): User {
    return User.fromPrisma({
      id: row.id,
      email: row.email,
      username: row.username,
      passwordHash: row.passwordHash,
      status: row.status as User['props']['status'],
      role: row.role as User['props']['role'],
      emailVerified: row.emailVerified,
      referralCode: row.referralCode,
      referredBy: row.referredBy,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      failedLoginAttempts: row.failedLoginAttempts,
      lastFailedAt: row.lastFailedAt,
      lockedUntil: row.lockedUntil,
    })
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { email } })
    return row ? this.toDomain(row) : null
  }

  async findById(id: string): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { id } })
    return row ? this.toDomain(row) : null
  }

  async findByReferralCode(code: string): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { referralCode: code } })
    return row ? this.toDomain(row) : null
  }

  async referralCodeExists(code: string): Promise<boolean> {
    return (await prisma.user.count({ where: { referralCode: code } })) > 0
  }

  async create(input: CreateUserInput): Promise<User> {
    if (input.email === null && input.passwordHash !== null) {
      throw new Error('OAUTH_USER_REQUIRES_NULL_PASSWORD')
    }
    const row = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        referralCode: input.referralCode,
        referredBy: input.referredBy ?? null,
        authProviders: { create: { provider: 'email' } },
      },
    })
    return this.toDomain(row)
  }

  async update(user: User): Promise<void> {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: user.emailVerified,
        passwordHash: user.passwordHash,
        lastLoginAt: user.props.lastLoginAt,
        status: user.status,
        failedLoginAttempts: user.props.failedLoginAttempts,
        lastFailedAt: user.props.lastFailedAt,
        lockedUntil: user.props.lockedUntil,
      },
    })
  }
}
