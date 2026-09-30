import { Controller, Get, Inject, Res } from '@nestjs/common'
import { type Response } from 'express'

import { GetReadinessUseCase } from '../application/use-cases/get-readiness.use-case'

/**
 * Health-эндпоинты (GAP-35). Тонкий presentation: маршруты, статус-коды и
 * формат ответа не менялись; сборка отчёта — GetReadinessUseCase, пробы —
 * infrastructure/probes. live — без зависимостей, ready — с проверкой БД/Redis.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(GetReadinessUseCase) private readonly readinessUseCase: GetReadinessUseCase) {}

  @Get()
  getHealth(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() }
  }

  @Get('live') liveness(): { live: boolean } {
    return { live: true }
  }

  @Get('ready')
  async readiness(@Res() res: Response): Promise<void> {
    const report = await this.readinessUseCase.execute()

    // Redis недоступен → 200 degraded (queue-only деградация); БД недоступна → 503
    if (!report.ready) {
      res.status(503).send({ ready: false, ...report.checks })
      return
    }
    res.status(200).send({ ready: true, degraded: report.degraded, ...report.checks })
  }
}
