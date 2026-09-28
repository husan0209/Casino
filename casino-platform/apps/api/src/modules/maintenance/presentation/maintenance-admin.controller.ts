import { Body, Controller, Post, UseGuards, UsePipes } from '@nestjs/common'
import { z } from 'zod'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { AuditLogService } from '../../admin/application/audit-log.service'
import { AuthGuard } from '../../auth/presentation/guards/auth.guard'
import { Roles, RolesGuard } from '../../auth/presentation/guards/roles.guard'
import { ReferralCalcService } from '../../referrals/application/referral-calc.service'

// GAP-21: ручной триггер начислений — date опционален (YYYY-MM-DD)
export const RunDailySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
      .optional(),
  })
  .strict()
export type RunDailyDto = z.infer<typeof RunDailySchema>

/**
 * Ручной триггер maintenance-задач. Пока один эндпоинт (GAP-32): запуск
 * реферальных начислений — тот же расчёт, что у cron-job `referral-daily`.
 * Эндпоинт переехал из referrals/presentation/referrals-admin.controller.ts
 * (решение В2) без изменений: путь admin/referrals/run-daily, guards
 * (AuthGuard + RolesGuard, superadmin), тело запроса и форма ответа сохранены.
 * ReferralCalcService инжектится через публичный экспорт ReferralsModule.
 */
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
@Controller('admin/referrals')
export class MaintenanceAdminController {
  constructor(
    private readonly referralCalc: ReferralCalcService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * GAP-32: ручной запуск реферальных начислений (GGR-share) — только superadmin.
   * Идемпотентен: повторный запуск за тот же день не создаёт вторых проводок
   * (дедуп findReward + idempotencyKey внутри runDaily). Cron-триггер — job
   * `referral-daily` maintenance-очереди (GAP-33).
   */
  @Post('run-daily')
  @Roles('superadmin')
  @UsePipes(new ZodValidationPipe(RunDailySchema))
  async runDaily(
    @Body() dto: RunDailyDto,
    @CurrentUser() admin: { id: string; email?: string },
  ): Promise<{ date: string; processed: number; credited: number; ok: boolean }> {
    const result = await this.referralCalc.runDaily(dto.date)
    await this.audit.log({
      actorType: 'user',
      actorId: admin.id,
      action: 'referrals.run_daily',
      targetType: 'referral_reward',
      payload: {
        date: result.date.toISOString().slice(0, 10),
        processed: result.processed,
        credited: result.credited,
      },
    })
    return { ok: true, ...result, date: result.date.toISOString().slice(0, 10) }
  }
}
