import { Inject, Injectable } from '@nestjs/common'
import { ISupportRepository, SUPPORT_REPOSITORY } from '../../domain/repositories/support.repository'
import { TicketNotFoundError, ForbiddenTicketError } from '../../domain/errors'
@Injectable()
export class CloseTicketUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository) {}
  async execute(ticketId: string, closedBy: 'user'|'admin', userId?: string) {
    const t = await this.repo.getAdmin(ticketId)
    if (!t) throw new TicketNotFoundError()
    if (closedBy === 'user' && userId && t.userId !== userId) throw new ForbiddenTicketError()
    await this.repo.closeTicket(ticketId, closedBy)
    return { ok: true }
  }
}
