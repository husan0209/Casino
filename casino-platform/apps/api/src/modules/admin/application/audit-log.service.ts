import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
@Injectable()
export class AuditLogService {
  async log(input: { actorType: 'user'|'admin'|'system'; actorId: string; action: string; targetType?: string; targetId?: string; payload?: any; ipAddress?: string; userAgent?: string }) {
    await prisma.auditLog.create({ data: input })
  }
}
