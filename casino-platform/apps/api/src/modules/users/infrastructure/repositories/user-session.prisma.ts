import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import { type IUserSessionRepository } from '../../domain/repositories/user-session.repository'

@Injectable()
export class PrismaUserSessionRepository implements IUserSessionRepository {
  async list(userId: string): Promise<{ id: string; ipAddress: string | null; userAgent: string | null; createdAt: Date; }[]> {
    const rows = await prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => ({
      id: r.id,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
    }))
  }
  async revoke(sessionId: string, userId: string): Promise<boolean> {
    const res = await prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return res.count > 0
  }
}
