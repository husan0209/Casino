/**
 * Prisma-реализация смены статуса учётной записи (порт — `user-status.repository`).
 *
 * Блокировка = `user.status='blocked'` + отзыв активных сессий в ОДНОЙ
 * `$transaction`. Раньше эти два шага делал `admin` (и это была запись в чужие
 * таблицы — G24); атомарность при переезде терять нельзя: между шагами игрок
 * остаётся «заблокированным» с живой сессией, а guard смотрит на сессию.
 *
 * `revokedAt: null` в фильтре — чтобы не трогать уже отозванные (повторная
 * блокировка не двигает дату чужих записей).
 */
import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import { type IUserStatusRepository } from '../../domain/repositories/user-status.repository'

@Injectable()
export class PrismaUserStatusRepository implements IUserStatusRepository {
  async block(userId: string): Promise<void> {
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { status: 'blocked' } }),
      prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])
  }

  async unblock(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { status: 'active' } })
  }
}
