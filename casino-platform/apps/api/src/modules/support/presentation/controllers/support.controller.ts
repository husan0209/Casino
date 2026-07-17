import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { CreateTicketUseCase } from '../../application/use-cases/create-ticket.use-case'
import { ListUserTicketsUseCase } from '../../application/use-cases/list-user-tickets.use-case'
import { GetTicketUseCase } from '../../application/use-cases/get-ticket.use-case'
import { SendMessageUseCase } from '../../application/use-cases/send-message.use-case'
import { CloseTicketUseCase } from '../../application/use-cases/close-ticket.use-case'

@UseGuards(AuthGuard)
@Controller('support')
export class SupportController {
  constructor(
    private createUc: CreateTicketUseCase,
    private listUc: ListUserTicketsUseCase,
    private getUc: GetTicketUseCase,
    private sendUc: SendMessageUseCase,
    private closeUc: CloseTicketUseCase,
  ) {}
  @Post('tickets')
  create(@CurrentUser() u:any, @Body() b:any){
    return this.createUc.execute(u.id, { subject: b.subject, category: b.category, message: b.message })
  }
  @Get('tickets')
  async list(@CurrentUser() u:any, @Query() q:any){
    const r = await this.listUc.execute(u.id, q.status, parseInt(q.page)||1, parseInt(q.per_page)||20)
    return { data: r.items, meta: { total: r.total }}
  }
  @Get('tickets/:id')
  get(@CurrentUser() u:any, @Param('id') id:string){ return this.getUc.execute(u.id, id, false) }
  @Post('tickets/:id/messages')
  send(@CurrentUser() u:any, @Param('id') id:string, @Body() b:any){
    return this.sendUc.execute({ ticketId: id, senderType: 'user', senderId: u.id, message: b.message, ownerCheckUserId: u.id })
  }
  @Post('tickets/:id/close')
  close(@CurrentUser() u:any, @Param('id') id:string){ return this.closeUc.execute(id, 'user', u.id) }
}
