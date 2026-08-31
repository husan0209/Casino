import { Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes, Inject } from '@nestjs/common'

import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe'
// NB: reviewed_by -> FK на AdminUser (см. схему) — пишем AdminUser.id,
// а не user.id: AuthGuard+RolesGuard здесь давали FK-violation на КАЖДОМ
// одобрении (найдено E2E, PR #15). Паттерн — как в admin-finance.controller.
import { AdminAuthGuard } from '../../../admin/presentation/admin-auth.guard'
import { IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'
import { KycDecisionReasonSchema } from '../dto/kyc.dto'

@UseGuards(AdminAuthGuard)
@Controller('admin/kyc')
export class KycAdminController {
  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}
  @Get() list(
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('per_page') per_page = '20',
  ) {
    return this.repo.listAdmin(status, parseInt(page), parseInt(per_page))
  }
  @Get(':id') async get(@Param('id') id: string) {
    const rec = await this.repo.getById(id)
    if (!rec) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'KYC profile not found' } }
    }
    // enrich with total deposited for admin view
    const totalDeposited = await this.repo.getTotalDepositedRub(rec.userId).catch(() => '0')
    return { ...rec, totalDepositedRub: totalDeposited }
  }
  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentUser() u: any) {
    await this.repo.setStatus(id, 'approved', undefined, u.id)
    return { ok: true }
  }
  @Post(':id/reject')
  @UsePipes(new ZodValidationPipe(KycDecisionReasonSchema))
  async reject(@Param('id') id: string, @Body() b: { reason: string }, @CurrentUser() u: any) {
    await this.repo.setStatus(id, 'rejected', b.reason, u.id)
    return { ok: true }
  }
  @Post(':id/request-resubmission')
  @UsePipes(new ZodValidationPipe(KycDecisionReasonSchema))
  async resubmit(@Param('id') id: string, @Body() b: { reason: string }, @CurrentUser() u: any) {
    await this.repo.setStatus(id, 'requires_resubmission', b.reason, u.id)
    return { ok: true }
  }
}
