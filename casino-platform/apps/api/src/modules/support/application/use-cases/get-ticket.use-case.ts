import { Inject, Injectable } from '@nestjs/common'

import { ISupportRepository, type MessageRow, SUPPORT_REPOSITORY, type TicketCategory, type TicketPriority, type TicketStatus } from '@modules/support/domain/repositories/support.repository'

import { ForbiddenTicketError, TicketNotFoundError } from '../../domain/errors'

@Injectable()
export class GetTicketUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository) {}
  async execute(userId: string, ticketId: string, isAdmin = false): Promise<{ messages: MessageRow[]; id: string; userId: string; subject: string; category: TicketCategory; status: TicketStatus; priority: TicketPriority; assignedTo: string | null; closedBy?: string | null; closedAt: Date | null; createdAt: Date; updatedAt: Date; }> {
    const ticket = isAdmin
      ? await this.repo.getAdmin(ticketId)
      : await this.repo.getTicketForUser(ticketId, userId)
    if (!ticket) {
      throw new TicketNotFoundError()
    }
    if (!isAdmin && ticket.userId !== userId) {
      throw new ForbiddenTicketError()
    }
    const messages = await this.repo.listMessages(ticketId, isAdmin)
    return { ...ticket, messages }
  }
}
