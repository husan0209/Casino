import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UsePipes, Inject } from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'
import { RolesGuard, Roles } from '@modules/auth/presentation/guards/roles.guard'
import { type TicketListItem, type MessageRow } from '@modules/support/domain/repositories/support.repository'

import { type CloseTicketUseCase } from '../../application/use-cases/close-ticket.use-case'
import { type GetTicketUseCase } from '../../application/use-cases/get-ticket.use-case'
import { type SendMessageUseCase } from '../../application/use-cases/send-message.use-case'
import {
  type ISupportRepository,
  SUPPORT_REPOSITORY,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../../domain/repositories/support.repository'
import {
  AddAdminMessageSchema,
  AssignTicketSchema,
  SetPrioritySchema,
} from '../dto/support.dto'

@UseGuards(AuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
@Controller('admin/support')
export class SupportAdminController {
  constructor(
    @Inject(SUPPORT_REPOSITORY) private readonly supportRepo: ISupportRepository,
    private readonly getTicketUseCase: GetTicketUseCase,
    private readonly sendMessageUseCase: SendMessageUseCase,
    private readonly closeTicketUseCase: CloseTicketUseCase,
  ) {}

  @Get('tickets')
  async list(
    @Query()
    queryParams: {
      status?: TicketStatus
      priority?: TicketPriority
      category?: TicketCategory
      assigned_to?: string
      user_id?: string
      search?: string
      page?: string
      per_page?: string
    },
  ): Promise<{ data: TicketListItem[]; meta: { total: number; }; }> {
    const page = parseInt(queryParams.page || '1', 10) || 1
    const perPage = parseInt(queryParams.per_page || '20', 10) || 20
    const result = await this.supportRepo.listAdmin({
      status: queryParams.status,
      priority: queryParams.priority,
      category: queryParams.category,
      assignedTo: queryParams.assigned_to,
      userId: queryParams.user_id,
      search: queryParams.search,
      page,
      perPage,
    })
    return {
      data: result.items,
      meta: { total: result.total },
    }
  }

  @Get('tickets/:id')
  get(@CurrentUser() _currentUser: unknown, @Param('id') ticketId: string): Promise<{ messages: MessageRow[]; id: string; userId: string; subject: string; category: TicketCategory; status: TicketStatus; priority: TicketPriority; assignedTo: string | null; closedBy?: string | null; closedAt: Date | null; createdAt: Date; updatedAt: Date; }> {
    return this.getTicketUseCase.execute('', ticketId, true)
  }

  @Post('tickets/:id/messages')
  @UsePipes(new ZodValidationPipe(AddAdminMessageSchema))
  send(
    @CurrentUser() currentUser: { id: string },
    @Param('id') ticketId: string,
    @Body() dto: { message: string; is_internal?: boolean },
  ): Promise<{ id: string; }> {
    return this.sendMessageUseCase.execute({
      ticketId,
      senderType: 'admin',
      senderId: currentUser.id,
      message: dto.message,
      isInternal: Boolean(dto.is_internal),
    })
  }

  @Post('tickets/:id/assign')
  @UsePipes(new ZodValidationPipe(AssignTicketSchema))
  async assign(@Param('id') ticketId: string, @Body() dto: { admin_id?: string }): Promise<{ ok: boolean; }> {
    await this.supportRepo.assign(ticketId, dto.admin_id || null)
    return { ok: true }
  }

  @Patch('tickets/:id/priority')
  @UsePipes(new ZodValidationPipe(SetPrioritySchema))
  async priority(@Param('id') ticketId: string, @Body() dto: { priority: string }): Promise<{ ok: boolean; }> {
    await this.supportRepo.setPriority(ticketId, dto.priority as TicketPriority)
    return { ok: true }
  }

  @Post('tickets/:id/close')
  close(@Param('id') ticketId: string): Promise<{ ok: boolean; }> {
    return this.closeTicketUseCase.execute(ticketId, 'admin')
  }
}
