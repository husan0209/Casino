/**
 * Разблокировка игрока (G24) — вторая половина операции блокировки.
 *
 * Отозванные сессии НЕ восстанавливаются: игрок после разблокировки входит
 * заново. Возвращать «живые» токены, отозванные при блокировке, было бы дырой —
 * refresh-токен мог пережить сам факт блокировки.
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  type IUserStatusRepository,
  USER_STATUS_REPOSITORY,
} from '../../domain/repositories/user-status.repository'

@Injectable()
export class UnblockPlayerUseCase {
  constructor(@Inject(USER_STATUS_REPOSITORY) private readonly status: IUserStatusRepository) {}

  execute(userId: string): Promise<void> {
    return this.status.unblock(userId)
  }
}
