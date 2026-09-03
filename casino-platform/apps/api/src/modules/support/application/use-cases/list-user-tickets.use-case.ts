import { Inject, Injectable } from '@nestjs/common'

import { type ISupportRepository, SUPPORT_REPOSITORY, type TicketListItem, type TicketStatus } from '@modules/support/domain/repositories/support.repository'

@Injectable()
export class ListUserTicketsUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository) {}
  execute(args: { userId: string; status?: TicketStatus; page: number; perPage: number }): Promise<{ items: TicketListItem[]; total: number; }> {
    return this.repo.listUserTickets({
      userId: args.userId,
      ...(args.status !== undefined ? { status: args.status } : {}),
      page: args.page,
      perPage: args.perPage,
    })
  }
}
