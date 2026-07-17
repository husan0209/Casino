import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
import { ISessionRepository } from '../../domain/repositories/session.repository'

@Injectable()
export class PrismaSessionRepository implements ISessionRepository {
  async create(data: any) { return prisma.session.create({ data }) as any }
  async findByRefreshTokenHash(hash: string) { return prisma.session.findFirst({ where: { refreshTokenHash: hash }}) as any }
  async revoke(id: string) { await prisma.session.update({ where: { id }, data: { revokedAt: new Date() }}) }
  async revokeAllUserSessions(userId: string) { await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() }}) }
}
