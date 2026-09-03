import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type UserActor } from '@/common/types/req-user'

import { AdminAuthGuard } from '@modules/admin/presentation/admin-auth.guard'
import { type IKycRepository, KYC_REPOSITORY, type KycProfileRow } from '@modules/kyc/domain/repositories/kyc.repository'

import { KycDecisionReasonSchema } from '../dto/kyc.dto'

@UseGuards(AdminAuthGuard)
@Controller('admin/kyc')
export class KycAdminController {
  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}
  @Get() list(
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('per_page') per_page = '20',
  ): Promise<{ items: KycProfileRow[]; total: number; }> {
    return this.repo.listAdmin(status, parseInt(page), parseInt(per_page))
  }
  @Get(':id') async get(@Param('id') id: string): Promise<{ success: boolean; error: { code: string; message: string; }; } | { totalDepositedRub: string; id: string; userId: string; status: string; firstName: string | null; lastName: string | null; dateOfBirth: Date | null; country: string | null; documentType: string | null; documentNumber: string | null; rejectionReason: string | null; submittedAt: Date | null; approvedAt: Date | null; rejectedAt: Date | null; success?: never; error?: never; }> {
    const rec = await this.repo.getById(id)
    if (!rec) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'KYC profile not found' } }
    }
    // enrich with total deposited for admin view
    const totalDeposited = await this.repo.getTotalDepositedRub(rec.userId).catch(() => '0')
    return { ...rec, totalDepositedRub: totalDeposited }
  }
  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentUser() u: UserActor): Promise<{ ok: boolean; }> {
    await this.repo.setStatus({ id, status: 'approved', reviewedBy: u.id })
    return { ok: true }
  }
  @Post(':id/reject')
  @UsePipes(new ZodValidationPipe(KycDecisionReasonSchema))
  async reject(@Param('id') id: string, @Body() b: { reason: string }, @CurrentUser() u: UserActor): Promise<{ ok: boolean; }> {
    await this.repo.setStatus({ id, status: 'rejected', reason: b.reason, reviewedBy: u.id })
    return { ok: true }
  }
  @Post(':id/request-resubmission')
  @UsePipes(new ZodValidationPipe(KycDecisionReasonSchema))
  async resubmit(@Param('id') id: string, @Body() b: { reason: string }, @CurrentUser() u: UserActor): Promise<{ ok: boolean; }> {
    await this.repo.setStatus({ id, status: 'requires_resubmission', reason: b.reason, reviewedBy: u.id })
    return { ok: true }
  }
}
