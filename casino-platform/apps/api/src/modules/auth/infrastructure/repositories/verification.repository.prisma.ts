import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import type {
  VerificationTokenView,
  IEmailVerificationRepository,
  IPasswordResetRepository,
} from '../../domain/repositories/verification-token.repository'

const toView = (row: {
  id: string
  userId: string
  token: string
  expiresAt: Date
  usedAt: Date | null
}): VerificationTokenView => ({ ...row })

@Injectable()
export class PrismaEmailVerificationRepository implements IEmailVerificationRepository {
  async create(userId: string, token: string, expiresAt: Date) {
    const row = await prisma.emailVerification.create({ data: { userId, token, expiresAt } })
    return toView(row)
  }
  async findByToken(token: string) {
    const row = await prisma.emailVerification.findUnique({ where: { token } })
    return row ? toView(row) : null
  }
  async markUsed(id: string) {
    await prisma.emailVerification.update({ where: { id }, data: { usedAt: new Date() } })
  }
}

@Injectable()
export class PrismaPasswordResetRepository implements IPasswordResetRepository {
  async create(userId: string, token: string, expiresAt: Date) {
    const row = await prisma.passwordReset.create({ data: { userId, token, expiresAt } })
    return toView(row)
  }
  async findByToken(token: string) {
    const row = await prisma.passwordReset.findUnique({ where: { token } })
    return row ? toView(row) : null
  }
  async markUsed(id: string) {
    await prisma.passwordReset.update({ where: { id }, data: { usedAt: new Date() } })
  }
}
