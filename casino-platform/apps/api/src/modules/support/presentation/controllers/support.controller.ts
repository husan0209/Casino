import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'

import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { CloseTicketUseCase } from '../../application/use-cases/close-ticket.use-case'
import { CreateTicketUseCase } from '../../application/use-cases/create-ticket.use-case'
import { GetTicketUseCase } from '../../application/use-cases/get-ticket.use-case'
import { ListUserTicketsUseCase } from '../../application/use-cases/list-user-tickets.use-case'
import { SendMessageUseCase } from '../../application/use-cases/send-message.use-case'

@UseGuards(AuthGuard)
@Controller('support')
export class SupportController {
  constructor(
    private readonly createTicketUseCase: CreateTicketUseCase,
    private readonly listTicketsUseCase: ListUserTicketsUseCase,
    private readonly getTicketUseCase: GetTicketUseCase,
    private readonly sendMessageUseCase: SendMessageUseCase,
    private readonly closeTicketUseCase: CloseTicketUseCase,
  ) {}

  @Post('tickets')
  create(
    @CurrentUser() currentUser: { id: string },
    @Body() dto: { subject: string; category: string; message: string },
  ) {
    return this.createTicketUseCase.execute(currentUser.id, {
      subject: dto.subject,
      category: dto.category,
      message: dto.message,
    })
  }

  @Get('tickets')
  async list(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: { status?: string; page?: string; per_page?: string },
  ) {
    const page = parseInt(queryParams.page || '1', 10) || 1
    const perPage = parseInt(queryParams.per_page || '20', 10) || 20
    const result = await this.listTicketsUseCase.execute(
      currentUser.id,
      queryParams.status,
      page,
      perPage,
    )
    return {
      data: result.items,
      meta: { total: result.total },
    }
  }

  @Get('tickets/:id')
  get(@CurrentUser() currentUser: { id: string }, @Param('id') ticketId: string) {
    return this.getTicketUseCase.execute(currentUser.id, ticketId, false)
  }

  @Post('tickets/:id/messages')
  send(
    @CurrentUser() currentUser: { id: string },
    @Param('id') ticketId: string,
    @Body() dto: { message: string },
  ) {
    return this.sendMessageUseCase.execute({
      ticketId,
      senderType: 'user',
      senderId: currentUser.id,
      message: dto.message,
      ownerCheckUserId: currentUser.id,
    })
  }

  @Post('tickets/:id/close')
  close(@CurrentUser() currentUser: { id: string }, @Param('id') ticketId: string) {
    return this.closeTicketUseCase.execute(ticketId, 'user', currentUser.id)
  }
}
