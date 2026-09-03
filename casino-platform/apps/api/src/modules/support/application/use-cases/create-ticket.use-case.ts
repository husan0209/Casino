import { Inject, Injectable } from '@nestjs/common'

import { TooManyOpenTicketsError } from '../../domain/errors'
import {
  ISupportRepository,
  SUPPORT_REPOSITORY,
  type TicketCategory,
} from '../../domain/repositories/support.repository'

@Injectable()
export class CreateTicketUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository) {}
  async execute(userId: string, input: { subject: string; category: TicketCategory; message: string }): Promise<{ id: string; }> {
    const open = await this.repo.countOpenByUser(userId)
    if (open >= 5) {
      throw new TooManyOpenTicketsError()
    }
    return this.repo.createTicket({ userId, subject: input.subject, category: input.category, message: input.message })
  }
}
