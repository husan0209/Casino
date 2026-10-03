import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'
import { Roles, RolesGuard } from '@modules/auth/presentation/guards/roles.guard'
import {
  type ISupportRepository,
  type MessageRow,
  SUPPORT_REPOSITORY,
  type TicketCategory,
  type TicketListItem,
  type TicketPriority,
  type TicketStatus,
} from '@modules/support/domain/repositories/support.repository'

import { AssignTicketUseCase } from '../../application/use-cases/assign-ticket.use-case'
import { CloseTicketUseCase } from '../../application/use-cases/close-ticket.use-case'
import { GetTicketUseCase } from '../../application/use-cases/get-ticket.use-case'
import { SendMessageUseCase } from '../../application/use-cases/send-message.use-case'
import { SetTicketPriorityUseCase } from '../../application/use-cases/set-ticket-priority.use-case'
import {
  AddAdminMessageSchema,
  AssignTicketSchema,
  SetPrioritySchema,
  type AssignTicketDto,
  type SetPriorityDto,
} from '../dto/support.dto'

@UseGuards(AuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
@Controller('admin/support')
export class SupportAdminController {
  constructor(
    // PORT используется ТОЛЬКО для чтения списков (В3: записи из
    // presentation убраны, они ушли в use-cases ниже).
    @Inject(SUPPORT_REPOSITORY) private readonly supportRepo: ISupportRepository,
    @Inject(GetTicketUseCase) private readonly getTicketUseCase: GetTicketUseCase,
    @Inject(SendMessageUseCase) private readonly sendMessageUseCase: SendMessageUseCase,
    @Inject(CloseTicketUseCase) private readonly closeTicketUseCase: CloseTicketUseCase,
    @Inject(AssignTicketUseCase)
    private readonly assignTicketUseCase: AssignTicketUseCase,
    @Inject(SetTicketPriorityUseCase)
    private readonly setTicketPriorityUseCase: SetTicketPriorityUseCase,
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
  ): Promise<{ data: TicketListItem[]; meta: { total: number } }> {
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
  get(
    @CurrentUser() _currentUser: unknown,
    @Param('id') ticketId: string,
  ): Promise<{
    messages: MessageRow[]
    id: string
    userId: string
    subject: string
    category: TicketCategory
    status: TicketStatus
    priority: TicketPriority
    assignedTo: string | null
    closedBy?: string | null
    closedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }> {
    return this.getTicketUseCase.execute('', ticketId, true)
  }

  @Post('tickets/:id/messages')
  @UsePipes(new ZodValidationPipe(AddAdminMessageSchema))
  send(
    @CurrentUser() currentUser: { id: string },
    @Param('id') ticketId: string,
    @Body() dto: { message: string; is_internal?: boolean },
  ): Promise<{ id: string }> {
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
  async assign(
    @Param('id') ticketId: string,
    @Body() dto: AssignTicketDto,
  ): Promise<{ ok: boolean }> {
    return await this.assignTicketUseCase.execute({
      ticketId,
      adminId: dto.admin_id ?? null,
    })
  }

  @Patch('tickets/:id/priority')
  @UsePipes(new ZodValidationPipe(SetPrioritySchema))
  async priority(
    @Param('id') ticketId: string,
    @Body() dto: SetPriorityDto,
  ): Promise<{ ok: boolean }> {
    return await this.setTicketPriorityUseCase.execute({
      ticketId,
      priority: dto.priority,
    })
  }

  @Post('tickets/:id/close')
  close(@Param('id') ticketId: string): Promise<{ ok: boolean }> {
    return this.closeTicketUseCase.execute(ticketId, 'admin')
  }
}
