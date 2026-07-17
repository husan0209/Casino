import { Inject, Injectable } from '@nestjs/common'
import { ISupportRepository, SUPPORT_REPOSITORY } from '../../domain/repositories/support.repository'
import { TooManyOpenTicketsError } from '../../domain/errors'
@Injectable()
export class CreateTicketUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository) {}
  async execute(userId: string, input: { subject: string; category: any; message: string }) {
    const open = await this.repo.countOpenByUser(userId)
    if (open >= 5) throw new TooManyOpenTicketsError()
    return this.repo.createTicket(userId, input.subject, input.category, input.message)
  }
}
