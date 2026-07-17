import { Inject, Injectable } from '@nestjs/common'
import { ISupportRepository, SUPPORT_REPOSITORY } from '../../domain/repositories/support.repository'
import { TicketNotFoundError, ForbiddenTicketError } from '../../domain/errors'
@Injectable()
export class GetTicketUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository) {}
  async execute(userId: string, ticketId: string, isAdmin = false) {
    const ticket = isAdmin
      ? await this.repo.getAdmin(ticketId)
      : await this.repo.getTicketForUser(ticketId, userId)
    if (!ticket) throw new TicketNotFoundError()
    if (!isAdmin && (ticket as any).userId !== userId) throw new ForbiddenTicketError()
    const messages = await this.repo.listMessages(ticketId, isAdmin)
    return { ...ticket, messages }
  }
}
