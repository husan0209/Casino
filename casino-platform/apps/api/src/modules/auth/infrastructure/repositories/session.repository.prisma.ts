import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import type { SessionCreateInput, SessionView, ISessionRepository } from '../../domain/repositories/session.repository'

@Injectable()
export class PrismaSessionRepository implements ISessionRepository {
  private toView(row: { id: string; userId: string; refreshTokenHash: string; ipAddress: string | null; userAgent: string | null; expiresAt: Date; revokedAt: Date | null }): SessionView {
    return { ...row }
  }

  async create(input: SessionCreateInput) {
    const row = await prisma.session.create({ data: input })
    return this.toView(row)
  }

  async findByRefreshTokenHash(hash: string) {
    const row = await prisma.session.findFirst({
      where: { refreshTokenHash: hash },
      orderBy: { createdAt: 'desc' },
    })
    return row ? this.toView(row) : null
  }

  async revoke(id: string) {
    await prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })
  }

  async revokeAllUserSessions(userId: string) {
    await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
  }
}
