import { Inject, Injectable } from '@nestjs/common'

import {
  HEALTH_PROBES,
  type HealthCheckResults,
  type HealthReport,
  type IHealthProbe,
} from '../../domain/health.ports'

/**
 * Use-case readiness (GAP-35): параллельно прогоняет пробы зависимостей и
 * собирает отчёт. Семантика: БД — fail-closed (недоступна → ready:false,
 * presentation отдаёт 503), Redis — best-effort (недоступен → degraded:true,
 * но 200: очередь — необязательная зависимость). HTTP-статусы и тело ответа —
 * ответственность presentation; здесь только агрегация.
 */
@Injectable()
export class GetReadinessUseCase {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: IHealthProbe[]) {}

  async execute(): Promise<HealthReport> {
    const results = await Promise.all(
      this.probes.map(async (probe) => ({ name: probe.name, status: await probe.check() })),
    )
    const checks = results.reduce<HealthCheckResults>(
      (acc, probe) => {
        acc[probe.name] = probe.status
        return acc
      },
      { db: 'fail', redis: 'fail' },
    )

    return {
      ready: checks.db === 'ok',
      degraded: checks.redis !== 'ok',
      checks,
    }
  }
}
