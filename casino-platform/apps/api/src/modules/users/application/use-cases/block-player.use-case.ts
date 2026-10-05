/**
 * Блокировка игрока (G24): операцию делает владелец данных, а не заказчик.
 *
 * До переезда `admin` сам писал `user.status` и `session.revokedAt` из своего
 * репозитория. Правило «заблокирован — значит без живых сессий» при этом жило
 * не в users, и второй потребитель (например, саморегуляция) мог его обойти.
 * Здесь application-слой users фиксирует порядок, а атомарность держит
 * реализация порта.
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  type IUserStatusRepository,
  USER_STATUS_REPOSITORY,
} from '../../domain/repositories/user-status.repository'

@Injectable()
export class BlockPlayerUseCase {
  constructor(@Inject(USER_STATUS_REPOSITORY) private readonly status: IUserStatusRepository) {}

  /**
   * Блокировка по id игрока. Ошибку «игрока нет» отдаёт реализация порта —
   * use case не знает про Prisma и не подменяет её своим статусом.
   */
  execute(userId: string): Promise<void> {
    return this.status.block(userId)
  }
}
