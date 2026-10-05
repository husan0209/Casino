/**
 * Список аудита админки (`GET /admin/audit-logs`) после переезда чтения к
 * владельцу таблицы (G27).
 *
 * Три слоя в одном файле, потому что проверяется одна цепочка: query-параметры
 * → схема → сервис → форма ответа. Отдельно держу границу: мусорный `actor_type`
 * теперь отсекается на входе, а не доходит до Prisma (откуда раньше возвращался 500).
 */
import { describe, expect, it, vi } from 'vitest'

import { AuditLogService } from '../src/modules/admin/application/audit-log.service'
import { AdminAuditController } from '../src/modules/admin/presentation/controllers/admin-audit.controller'
import { AuditListQuerySchema } from '../src/modules/admin/presentation/dto/admin-audit.dto'

import type { IAuditLogRepository } from '../src/modules/admin/domain/admin.repository'

const ROW = {
  id: 'al-1',
  createdAt: new Date('2026-10-01T09:00:00.000Z'),
  actorType: 'admin',
  actorId: 'adm-1',
  action: 'admin.withdrawal.approved',
  targetType: 'payment_request',
  targetId: 'pr-1',
  payload: { ok: true },
  ipAddress: '203.0.113.9',
  userAgent: 'Mozilla/5.0',
} as const

describe('AuditListQuerySchema — форма запроса', () => {
  it('значения actor_type берутся из enum-справочника схемы', () => {
    expect(AuditListQuerySchema.parse({ actor_type: 'admin' }).actor_type).toBe('admin')
    // опечатка не должна доходить до Prisma: раньше это был 500 вместо 400
    expect(AuditListQuerySchema.safeParse({ actor_type: 'administrator' }).success).toBe(false)
  })

  it('пагинация: дефолты 1/50, сверх потолка — урезание, как было', () => {
    const parsed = AuditListQuerySchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.per_page).toBe(50)
    expect(AuditListQuerySchema.parse({ per_page: '5000' }).per_page).toBe(200)
  })

  it('некорректные страницы отсекаются, а не превращаются в «первая страница»', () => {
    expect(AuditListQuerySchema.safeParse({ page: '0' }).success).toBe(false)
    expect(AuditListQuerySchema.safeParse({ page: '-1' }).success).toBe(false)
    expect(AuditListQuerySchema.safeParse({ per_page: 'abc' }).success).toBe(false)
  })

  it('пустые строки фильтров не проходят — это «нет фильтра», а не поиск по пустоте', () => {
    expect(AuditListQuerySchema.safeParse({ action: '   ' }).success).toBe(false)
  })
})

describe('AuditLogService.list', () => {
  it('отдаёт пару репозитория как items + total', async () => {
    const list = vi.fn(async (): Promise<[unknown[], number]> => [[ROW], 7])
    const service = new AuditLogService({ log: vi.fn(), list } as unknown as IAuditLogRepository)

    const res = await service.list({ page: 1, perPage: 20 })

    expect(res).toEqual({ items: [ROW], total: 7 })
    expect(list).toHaveBeenCalledWith({ page: 1, perPage: 20 })
  })
})

describe('AdminAuditController.list', () => {
  function makeController(listImpl?: (filter: never) => Promise<never>) {
    const list = vi.fn(
      listImpl ??
        (async (): Promise<{ items: unknown[]; total: number }> => ({
          items: [ROW],
          total: 1,
        })),
    )
    const service = { list } as never
    return { controller: new AdminAuditController(service), list }
  }

  it('snake_case query превращается в camelCase фильтр владельца таблицы', async () => {
    const { controller, list } = makeController()
    const query = AuditListQuerySchema.parse({
      page: '2',
      per_page: '30',
      actor_type: 'user',
      actor_id: 'u-1',
      action: 'admin.withdrawal.',
      target_type: 'payment_request',
    })

    const res = await controller.list(query)

    expect(list).toHaveBeenCalledWith({
      actorType: 'user',
      actorId: 'u-1',
      action: 'admin.withdrawal.',
      targetType: 'payment_request',
      page: 2,
      perPage: 30,
    })
    expect(res.items).toEqual([ROW])
    expect(res.meta).toEqual({ page: 2, perPage: 30, total: 1 })
  })

  it('без фильтров в сервис уходят только страница и размер', async () => {
    const { controller, list } = makeController()

    await controller.list(AuditListQuerySchema.parse({}))

    expect(list).toHaveBeenCalledWith({
      actorType: undefined,
      actorId: undefined,
      action: undefined,
      targetType: undefined,
      page: 1,
      perPage: 50,
    })
  })
})
