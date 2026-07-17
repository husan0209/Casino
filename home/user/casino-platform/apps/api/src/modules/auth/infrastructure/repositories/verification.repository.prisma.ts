import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
import { IEmailVerificationRepository, IPasswordResetRepository } from '../../domain/repositories/verification-token.repository'

@Injectable()
export class PrismaEmailVerificationRepository implements IEmailVerificationRepository {
  async create(userId: string, token: string, expiresAt: Date) {
    return prisma.emailVerification.create({ data: { userId, token, expiresAt }}) as any
  }
  async findByToken(token: string) { return prisma.emailVerification.findUnique({ where: { token }}) as any }
  async markUsed(id: string) { await prisma.emailVerification.update({ where: { id }, data: { usedAt: new Date() }}) }
}

@Injectable()
export class PrismaPasswordResetRepository implements IPasswordResetRepository {
  async create(userId: string, token: string, expiresAt: Date) {
    return prisma.passwordReset.create({ data: { userId, token, expiresAt }}) as any
  }
  async findByToken(token: string) { return prisma.passwordReset.findUnique({ where: { token }}) as any }
  async markUsed(id: string) { await prisma.passwordReset.update({ where: { id }, data: { usedAt: new Date() }}) }
}
