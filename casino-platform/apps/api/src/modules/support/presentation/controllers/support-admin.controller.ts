import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { RolesGuard, Roles } from '../../../auth/presentation/guards/roles.guard'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { ISupportRepository, SUPPORT_REPOSITORY } from '../../domain/repositories/support.repository'
import { Inject } from '@nestjs/common'
import { GetTicketUseCase } from '../../application/use-cases/get-ticket.use-case'
import { SendMessageUseCase } from '../../application/use-cases/send-message.use-case'
import { CloseTicketUseCase } from '../../application/use-cases/close-ticket.use-case'

@UseGuards(AuthGuard, RolesGuard)
@Roles('admin','superadmin')
@Controller('admin/support')
export class SupportAdminController {
  constructor(
    @Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository,
    private getUc: GetTicketUseCase,
    private sendUc: SendMessageUseCase,
    private closeUc: CloseTicketUseCase,
  ) {}
  @Get('tickets')
  async list(@Query() q:any){
    const r = await this.repo.listAdmin({
      status: q.status, priority: q.priority, category: q.category,
      assignedTo: q.assigned_to, userId: q.user_id, search: q.search,
      page: parseInt(q.page)||1, perPage: parseInt(q.per_page)||20
    })
    return { data: r.items, meta: { total: r.total } }
  }
  @Get('tickets/:id')
  get(@CurrentUser() _u:any, @Param('id') id:string){ return this.getUc.execute('', id, true) }
  @Post('tickets/:id/messages')
  send(@CurrentUser() u:any, @Param('id') id:string, @Body() b:any){
    return this.sendUc.execute({ ticketId: id, senderType: 'admin', senderId: u.id, message: b.message, isInternal: !!b.is_internal })
  }
  @Post('tickets/:id/assign')
  async assign(@Param('id') id:string, @Body() b:any){
    await this.repo.assign(id, b.admin_id || null); return { ok: true }
  }
  @Patch('tickets/:id/priority')
  async priority(@Param('id') id:string, @Body() b:any){
    await this.repo.setPriority(id, b.priority); return { ok: true }
  }
  @Post('tickets/:id/close')
  close(@Param('id') id:string){ return this.closeUc.execute(id, 'admin') }
}
