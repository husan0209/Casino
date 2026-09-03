import { Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'
import { type MessageRow, type TicketCategory, type TicketListItem, type TicketPriority, type TicketStatus } from '@modules/support/domain/repositories/support.repository'

import { type CloseTicketUseCase } from '../../application/use-cases/close-ticket.use-case'
import { type CreateTicketUseCase } from '../../application/use-cases/create-ticket.use-case'
import { type GetTicketUseCase } from '../../application/use-cases/get-ticket.use-case'
import { type ListUserTicketsUseCase } from '../../application/use-cases/list-user-tickets.use-case'
import { type SendMessageUseCase } from '../../application/use-cases/send-message.use-case'
import { AddTicketMessageSchema, CreateTicketSchema } from '../dto/support.dto'

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
  @UsePipes(new ZodValidationPipe(CreateTicketSchema))
  create(
    @CurrentUser() currentUser: { id: string },
    @Body() dto: { subject: string; category: string; message: string },
  ): Promise<{ id: string; }> {
    return this.createTicketUseCase.execute(currentUser.id, {
      subject: dto.subject,
      category: dto.category as TicketCategory,
      message: dto.message,
    })
  }

  @Get('tickets')
  async list(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: { status?: string; page?: string; per_page?: string },
  ): Promise<{ data: TicketListItem[]; meta: { total: number; }; }> {
    const page = parseInt(queryParams.page || '1', 10) || 1
    const perPage = parseInt(queryParams.per_page || '20', 10) || 20
    const result = await this.listTicketsUseCase.execute({
      userId: currentUser.id,
      ...(queryParams.status !== undefined
        ? { status: queryParams.status as TicketStatus }
        : {}),
      page,
      perPage,
    })
    return {
      data: result.items,
      meta: { total: result.total },
    }
  }

  @Get('tickets/:id')
  get(@CurrentUser() currentUser: { id: string }, @Param('id') ticketId: string): Promise<{ messages: MessageRow[]; id: string; userId: string; subject: string; category: TicketCategory; status: TicketStatus; priority: TicketPriority; assignedTo: string | null; closedBy?: string | null; closedAt: Date | null; createdAt: Date; updatedAt: Date; }> {
    return this.getTicketUseCase.execute(currentUser.id, ticketId, false)
  }

  @Post('tickets/:id/messages')
  @UsePipes(new ZodValidationPipe(AddTicketMessageSchema))
  send(
    @CurrentUser() currentUser: { id: string },
    @Param('id') ticketId: string,
    @Body() dto: { message: string },
  ): Promise<{ id: string; }> {
    return this.sendMessageUseCase.execute({
      ticketId,
      senderType: 'user',
      senderId: currentUser.id,
      message: dto.message,
      ownerCheckUserId: currentUser.id,
    })
  }

  @Post('tickets/:id/close')
  close(@CurrentUser() currentUser: { id: string }, @Param('id') ticketId: string): Promise<{ ok: boolean; }> {
    return this.closeTicketUseCase.execute(ticketId, 'user', currentUser.id)
  }
}
