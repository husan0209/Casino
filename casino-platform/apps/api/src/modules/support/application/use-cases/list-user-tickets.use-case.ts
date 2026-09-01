import { Inject, Injectable } from '@nestjs/common'

import {
  ISupportRepository,
  SUPPORT_REPOSITORY,
} from '../../domain/repositories/support.repository'

@Injectable()
export class ListUserTicketsUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository) {}
  execute(args: { userId: string; status?: any; page: number; perPage: number }) {
    return this.repo.listUserTickets({ userId: args.userId, status: args.status, page: args.page, perPage: args.perPage })
  }
}
