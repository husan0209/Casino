import { Inject, Injectable } from '@nestjs/common'
import { ISupportRepository, SUPPORT_REPOSITORY } from '../../domain/repositories/support.repository'
import { TicketNotFoundError, TicketClosedError, ForbiddenTicketError } from '../../domain/errors'
@Injectable()
export class SendMessageUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository) {}
  async execute(input: { ticketId: string; senderType: 'user'|'admin'; senderId: string; message: string; isInternal?: boolean; ownerCheckUserId?: string }) {
    const t = await this.repo.getAdmin(input.ticketId)
    if (!t) throw new TicketNotFoundError()
    if (t.status === 'closed') throw new TicketClosedError()
    if (input.senderType === 'user' && input.ownerCheckUserId && t.userId !== input.ownerCheckUserId) throw new ForbiddenTicketError()
    const msg = await this.repo.addMessage(input.ticketId, input.senderType, input.senderId, input.message, !!input.isInternal, [])
    if (input.senderType === 'admin' && !input.isInternal) {
      await this.repo.setStatus(input.ticketId, 'waiting_user')
    } else if (input.senderType === 'user' && t.status === 'waiting_user') {
      await this.repo.setStatus(input.ticketId, 'in_progress')
    }
    return msg
  }
}
