import { Inject, Injectable } from '@nestjs/common'
import { MessageRow, TicketCategory, TicketStatus, TicketPriority } from '@modules/support/domain/repositories/support.repository'

import { TicketNotFoundError, ForbiddenTicketError } from '../../domain/errors'
import {
  ISupportRepository,
  SUPPORT_REPOSITORY,
} from '../../domain/repositories/support.repository'

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
