import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, Inject } from '@nestjs/common'

import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { RolesGuard, Roles } from '../../../auth/presentation/guards/roles.guard'
import { CloseTicketUseCase } from '../../application/use-cases/close-ticket.use-case'
import { GetTicketUseCase } from '../../application/use-cases/get-ticket.use-case'
import { SendMessageUseCase } from '../../application/use-cases/send-message.use-case'
import { ISupportRepository, SUPPORT_REPOSITORY, type TicketPriority } from '../../domain/repositories/support.repository'

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
    @Query() queryParams: {
      status?: any
      priority?: any
      category?: any
      assigned_to?: string
      user_id?: string
      search?: string
      page?: string
      per_page?: string
    },
  ) {
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
  ) {
    return this.getTicketUseCase.execute('', ticketId, true)
  }

  @Post('tickets/:id/messages')
  send(
    @CurrentUser() currentUser: { id: string },
    @Param('id') ticketId: string,
    @Body() dto: { message: string; is_internal?: boolean },
  ) {
    return this.sendMessageUseCase.execute({
      ticketId,
      senderType: 'admin',
      senderId: currentUser.id,
      message: dto.message,
      isInternal: Boolean(dto.is_internal),
    })
  }

  @Post('tickets/:id/assign')
  async assign(
    @Param('id') ticketId: string,
    @Body() dto: { admin_id?: string },
  ) {
    await this.supportRepo.assign(ticketId, dto.admin_id || null)
    return { ok: true }
  }

  @Patch('tickets/:id/priority')
  async priority(
    @Param('id') ticketId: string,
    @Body() dto: { priority: string },
  ) {
    await this.supportRepo.setPriority(ticketId, dto.priority as TicketPriority)
    return { ok: true }
  }

  @Post('tickets/:id/close')
  close(@Param('id') ticketId: string) {
    return this.closeTicketUseCase.execute(ticketId, 'admin')
  }
}
