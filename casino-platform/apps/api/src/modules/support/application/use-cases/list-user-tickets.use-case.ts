import { Inject, Injectable } from '@nestjs/common'
import { ISupportRepository, SUPPORT_REPOSITORY } from '../../domain/repositories/support.repository'
@Injectable()
export class ListUserTicketsUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private repo: ISupportRepository) {}
  execute(userId: string, status?: any, page = 1, perPage = 20) {
    return this.repo.listUserTickets(userId, status, page, perPage)
  }
}
