/**
 * G24: блокировка игрока и отзыв его сессий — запись в таблицы, которыми
 * владеет `users` (`User` = users+auth, `Session` = auth+users по карте
 * MODEL_OWNERS). Раньше обе строки писал `admin` из своего репозитория.
 *
 * Проверяются три вещи, которые типы не держат:
 *  1) блокировка — ОДИН вызов `$transaction` с обеими записями: два
 *     последовательных апдейта оставляют игрока «заблокированным» с живой
 *     сессией, если второй упадёт (guard смотрит на сессию, не на статус);
 *  2) отзыв целится только в живые сессии (`revokedAt: null`) — повторная
 *     блокировка не двигает дату уже отозванных;
 *  3) сборка DI: порт закрыт Prisma-реализацией, `AdminModule` импортирует
 *     `UsersModule`, а у admin-репозитория больше нет методов блокировки.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

const userUpdate = vi.fn()
const sessionUpdateMany = vi.fn()
const transaction = vi.fn()

vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return {
    ...actual,
    prisma: {
      user: { update: (args: unknown) => userUpdate(args) },
      session: { updateMany: (args: unknown) => sessionUpdateMany(args) },
      $transaction: (ops: unknown[]) => transaction(ops),
    },
  }
})

import { AdminModule } from '../src/modules/admin/admin.module'
import { PrismaAdminUserRepository } from '../src/modules/admin/infrastructure/repositories/admin.prisma.repository'
import { BlockPlayerUseCase } from '../src/modules/users/application/use-cases/block-player.use-case'
import { UnblockPlayerUseCase } from '../src/modules/users/application/use-cases/unblock-player.use-case'
import { USER_STATUS_REPOSITORY } from '../src/modules/users/domain/repositories/user-status.repository'
import { UsersFacade } from '../src/modules/users/facade/users.facade'
import { PrismaUserStatusRepository } from '../src/modules/users/infrastructure/repositories/user-status.prisma'
import { UsersModule } from '../src/modules/users/users.module'

beforeEach(() => {
  userUpdate.mockReset().mockResolvedValue({ id: 'u-9' })
  sessionUpdateMany.mockReset().mockResolvedValue({ count: 2 })
  transaction.mockReset().mockResolvedValue([])
})

describe('PrismaUserStatusRepository', () => {
  const repo = new PrismaUserStatusRepository()

  it('блокировка — одна $transaction из двух записей, а не два отдельных апдейта', async () => {
    await repo.block('u-9')

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0]![0]).toHaveLength(2)
    expect(userUpdate).toHaveBeenCalledTimes(1)
    expect(sessionUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('статус blocked и отзыв живых сессий: фильтры на месте', async () => {
    await repo.block('u-9')

    expect(userUpdate.mock.calls[0]![0]).toEqual({
      where: { id: 'u-9' },
      data: { status: 'blocked' },
    })
    expect(sessionUpdateMany.mock.calls[0]![0]).toEqual({
      where: { userId: 'u-9', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it('разблокировка — только статус: отозванные сессии не восстанавливаются', async () => {
    await repo.unblock('u-9')

    expect(userUpdate.mock.calls[0]![0]).toEqual({
      where: { id: 'u-9' },
      data: { status: 'active' },
    })
    expect(sessionUpdateMany).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('сбой транзакции долетает до вызывающего: админ не должен увидеть «заблокировано»', async () => {
    transaction.mockRejectedValue(new Error('deadlock'))

    await expect(repo.block('u-9')).rejects.toThrow('deadlock')
  })
})

describe('UsersFacade и сборка модулей (G24)', () => {
  it('фасад наружу зовёт use case, а не репозиторий напрямую', async () => {
    const block = vi.fn().mockResolvedValue(undefined)
    const unblock = vi.fn().mockResolvedValue(undefined)
    const facade = new UsersFacade(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { execute: block } as unknown as BlockPlayerUseCase,
      { execute: unblock } as unknown as UnblockPlayerUseCase,
    )

    await facade.blockPlayer('u-9')
    await facade.unblockPlayer('u-9')

    expect(block.mock.calls).toEqual([['u-9']])
    expect(unblock.mock.calls).toEqual([['u-9']])
  })

  const usersProviders = Reflect.getMetadata('providers', UsersModule) as unknown[]
  const adminImports = Reflect.getMetadata('imports', AdminModule) as unknown[]

  it('UsersModule закрывает порт USER_STATUS_REPOSITORY Prisma-реализацией', () => {
    const entry = usersProviders.find(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        (p as { provide?: unknown }).provide === USER_STATUS_REPOSITORY,
    ) as { useClass?: unknown } | undefined
    expect(entry?.useClass).toBe(PrismaUserStatusRepository)
  })

  it('оба use case стоят в providers UsersModule — иначе фасад нерезолвим на старте', () => {
    expect(usersProviders).toContain(BlockPlayerUseCase)
    expect(usersProviders).toContain(UnblockPlayerUseCase)
  })

  it('AdminModule импортирует UsersModule — блокировка идёт через UsersFacade', () => {
    expect(adminImports).toContain(UsersModule)
  })

  it('у репозитория admin больше нет блокировки игроков (порт сузился до админских таблиц)', () => {
    const prototype = PrismaAdminUserRepository.prototype as unknown as Record<string, unknown>
    expect(prototype).not.toHaveProperty('blockPlayer')
    expect(prototype).not.toHaveProperty('unblockPlayer')
  })
})
