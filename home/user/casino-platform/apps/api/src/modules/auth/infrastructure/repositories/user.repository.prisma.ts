import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
import { IUserRepository } from '../../domain/repositories/user.repository'
import { UserEntity } from '../../domain/entities/user.entity'

function toDomain(row: any): UserEntity {
  return new UserEntity({
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    username: row.username,
    passwordHash: row.passwordHash,
    status: row.status,
    role: row.role,
    referralCode: row.referralCode,
    referredBy: row.referredBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  })
}

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  async findById(id: string) {
    const row = await prisma.user.findUnique({ where: { id }})
    return row ? toDomain(row) : null
  }
  async findByEmail(email: string) {
    const row = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() }})
    return row ? toDomain(row) : null
  }
  async findByReferralCode(code: string) {
    const row = await prisma.user.findUnique({ where: { referralCode: code }})
    return row ? toDomain(row) : null
  }
  async existsByEmail(email: string) {
    const c = await prisma.user.count({ where: { email: email.toLowerCase().trim() }})
    return c > 0
  }
  async save(user: UserEntity) {
    const d = user.toJSON()
    const created = await prisma.user.create({
      data: {
        email: d.email?.toLowerCase().trim() ?? null,
        emailVerified: d.emailVerified,
        username: d.username,
        passwordHash: d.passwordHash,
        status: d.status as any,
        role: d.role as any,
        referralCode: d.referralCode,
        referredBy: d.referredBy,
      }
    })
    return toDomain(created)
  }
  async update(user: UserEntity) {
    const d = user.toJSON()
    const updated = await prisma.user.update({
      where: { id: d.id },
      data: {
        emailVerified: d.emailVerified,
        passwordHash: d.passwordHash,
        status: d.status as any,
        lastLoginAt: d.lastLoginAt,
      }
    })
    return toDomain(updated)
  }
}
