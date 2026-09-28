import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import { type IHealthProbe, type ProbeName, type ProbeStatus } from '../../domain/health.ports'

/** Проба БД (GAP-35): честный SELECT 1 — fail-closed, ошибка запроса → 'fail'. */
@Injectable()
export class PrismaHealthProbe implements IHealthProbe {
  readonly name: ProbeName = 'db'

  async check(): Promise<ProbeStatus> {
    return prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const).catch(() => 'fail' as const)
  }
}
