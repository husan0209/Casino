import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { RolesGuard, Roles } from '../../../auth/presentation/guards/roles.guard'
import { IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'
import { Inject } from '@nestjs/common'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'

@UseGuards(AuthGuard, RolesGuard)
@Roles('admin','superadmin')
@Controller('admin/kyc')
export class KycAdminController {
  constructor(@Inject(KYC_REPOSITORY) private repo: IKycRepository) {}
  @Get() list(@Query('status') status?: string, @Query('page') page = '1', @Query('per_page') per_page = '20') {
    return this.repo.listAdmin(status, parseInt(page), parseInt(per_page))
  }
  @Get(':id') get(@Param('id') id: string) { return { todo: true } }
  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentUser() u: any) {
    await this.repo.setStatus(id, 'approved', undefined, u.id); return { ok: true }
  }
  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() b: { reason: string }, @CurrentUser() u: any) {
    await this.repo.setStatus(id, 'rejected', b.reason, u.id); return { ok: true }
  }
  @Post(':id/request-resubmission')
  async resubmit(@Param('id') id: string, @Body() b: { reason: string }, @CurrentUser() u: any) {
    await this.repo.setStatus(id, 'requires_resubmission', b.reason, u.id); return { ok: true }
  }
}
