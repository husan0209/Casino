/**
 * Инфраструктурная спека на служебные записи `users` (GAP-62).
 *
 * До переноса INSERT/DELETE в `users` делал модуль affiliate, и эти два запроса
 * были единственным местом, где часть записи чужой таблицы. Перенос обязан
 * сохранить SQL-семантику 1-в-1, иначе поменялся бы ответ эндпоинтов
 * `POST /affiliate/register` и `POST /admin/affiliates`:
 *  - create: ровно `{ email: null, status: 'active', referralCode }` и
 *    `select: { id: true }` — наружу отдаётся только id;
 *  - delete: вместо `delete({ id })` — `deleteMany({ where: { id, email: null } })`.
 *    Разница осознанная и в сторону безопасности: `users` связан каскадами
 *    (`onDelete: Cascade` у кошелька, ledger, сессий), и `delete` по любому id
 *    снёс бы аккаунт реального игрока вместе с деньгами. Условие `email: null`
 *    оставляет методу ровно ту область, ради которой он создан, — служебную
 *    учётку партнёра, у которой email никогда не было.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@casino/database', () => ({
  prisma: {
    user: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

import { prisma } from '@casino/database'

import { PrismaUserProfileRepository } from '../src/modules/users/infrastructure/repositories/user-profile.prisma'

/** Делегат `user` из замоканного клиента: только два метода, которые тест вызвает. */
type UserDelegate = {
  create: ReturnType<typeof vi.fn>
  deleteMany: ReturnType<typeof vi.fn>
}

describe('PrismaUserProfileRepository: служебные учётные записи (GAP-62)', () => {
  const repository = new PrismaUserProfileRepository()
  const delegate = prisma.user as unknown as UserDelegate

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createServiceUser пишет ровно те колонки, что писал affiliate', async () => {
    delegate.create.mockResolvedValue({ id: 'partner-player-1' })

    const created = await repository.createServiceUser({
      email: null,
      status: 'active',
      referralCode: 'affK7M2QX9P',
    })

    expect(delegate.create).toHaveBeenCalledWith({
      data: { email: null, status: 'active', referralCode: 'affK7M2QX9P' },
      select: { id: true },
    })
    expect(created).toEqual({ id: 'partner-player-1' })
  })

  it('compensating delete бьёт по id И по email IS NULL — чужой аккаунт не тронет', async () => {
    delegate.deleteMany.mockResolvedValue({ count: 1 })

    const removed = await repository.deleteServiceUser('partner-player-1')

    expect(delegate.deleteMany).toHaveBeenCalledWith({
      where: { id: 'partner-player-1', email: null },
    })
    expect(removed).toBe(true)
  })

  it('строки нет или это не служебная запись → false, без исключения', async () => {
    // deleteMany не бросает P2025 на отсутствующей строке (в отличие от
    // delete): повторный compensate обязан быть безопасным.
    delegate.deleteMany.mockResolvedValue({ count: 0 })

    await expect(repository.deleteServiceUser('missing-id')).resolves.toBe(false)
  })

  it('ошибка БД при удалении пробрасывается — потребитель решает, что с ней делать', async () => {
    const failure = new Error('db down')
    delegate.deleteMany.mockRejectedValue(failure)

    await expect(repository.deleteServiceUser('partner-player-1')).rejects.toBe(failure)
  })
})
