/**
 * G24: maintenance больше не пишет в чужие таблицы.
 *
 * Три задачи трогали строки других модулей напрямую:
 *  - `expire-deposits` → `payment_requests` (владелец payments),
 *  - `withdrawal-reminder` → `audit_logs` (владелец admin),
 *  - `cleanup-sessions` → `sessions` (владелец auth+users).
 * Записи ушли фасадам владельцев; в maintenance остались только чтения (они
 * легальны по ADR GAP-51) и решение «что значит ноль обновлённых строк».
 *
 * Держим семантику, которую легко потерять при переезде:
 *  - истечение по-прежнему УСЛОВНОЕ (`pending → expired`) — иначе гонка с
 *    вебхуком затирает completed; проверается payload самого запроса в payments;
 *  - уборка сессий удаляет по тому же OR-условию, что и раньше;
 *  - напоминание пишется строго: строка служит ключом дедупа, молчаливый пропуск
 *    означал бы повторное письмо через час.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

const paymentUpdateMany = vi.fn()
const sessionDeleteMany = vi.fn()

vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return {
    ...actual,
    prisma: {
      paymentRequest: { updateMany: (args: unknown) => paymentUpdateMany(args) },
      session: { deleteMany: (args: unknown) => sessionDeleteMany(args) },
    },
  }
})

import { AdminFacade } from '../src/modules/admin/facade/admin.facade'
import { PaymentRequestNotPendingError } from '../src/modules/maintenance/domain/errors'
import {
  PrismaMaintenanceRepo,
  PrismaReminderAuditRepo,
  PrismaSessionMaintenanceRepo,
} from '../src/modules/maintenance/infrastructure/maintenance.prisma.repo'
import { PaymentsFacade } from '../src/modules/payments/facade/payments.facade'
import { PaymentRequestRepository } from '../src/modules/payments/infrastructure/repositories/payment-request.repository'
import { PurgeDeadSessionsUseCase } from '../src/modules/users/application/use-cases/purge-dead-sessions.use-case'
import { PrismaUserSessionRepository } from '../src/modules/users/infrastructure/repositories/user-session.prisma'

import type { AuditLogService } from '../src/modules/admin/application/audit-log.service'
import type {
  INowPaymentsClient,
  IPaymentRequestRepository,
} from '../src/modules/payments/domain/payments.ports'
import type { IUserSessionRepository } from '../src/modules/users/domain/repositories/user-session.repository'
import type { UsersFacade } from '../src/modules/users/facade/users.facade'

beforeEach(() => {
  paymentUpdateMany.mockReset().mockResolvedValue({ count: 1 })
  sessionDeleteMany.mockReset().mockResolvedValue({ count: 4 })
})

describe('payments: условное истечение заявки', () => {
  it('expireIfPending обновляет только pending и не трогает другие статусы', async () => {
    const repo = new PaymentRequestRepository()

    await expect(repo.expireIfPending('pr-1')).resolves.toBe(1)
    expect(paymentUpdateMany.mock.calls[0]![0]).toEqual({
      where: { id: 'pr-1', status: 'pending' },
      data: { status: 'expired' },
    })
  })

  it('фасад превращает count в boolean: ноль = заявка уже не pending', async () => {
    const inner: Partial<IPaymentRequestRepository> = {
      expireIfPending: async () => 0,
    }
    const facade = new PaymentsFacade(
      {} as unknown as INowPaymentsClient,
      inner as IPaymentRequestRepository,
    )

    await expect(facade.expirePendingPayment('pr-2')).resolves.toBe(false)
  })
})

describe('users: уборка мёртвых сессий', () => {
  it('purgeDead удаляет expired ИЛИ отозванные до cutoff', async () => {
    const cutoff = new Date('2026-09-27T00:00:00.000Z')
    const repo = new PrismaUserSessionRepository()

    await expect(repo.purgeDead(cutoff)).resolves.toBe(4)
    const args = sessionDeleteMany.mock.calls[0]![0] as {
      where: { OR: Array<Record<string, unknown>> }
    }
    expect(args.where.OR).toEqual([{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }])
  })

  it('use case пробрасывает cutoff в порт и отдаёт число удалённых', async () => {
    const purgeDead = vi.fn().mockResolvedValue(3)
    const uc = new PurgeDeadSessionsUseCase({ purgeDead } as unknown as IUserSessionRepository)
    const cutoff = new Date('2026-09-20T12:00:00.000Z')

    await expect(uc.execute(cutoff)).resolves.toBe(3)
    expect(purgeDead.mock.calls).toEqual([[cutoff]])
  })
})

describe('AdminFacade: два контракта записи аудита', () => {
  function makeFacade(log: () => Promise<void>) {
    return new AdminFacade({ log } as unknown as AuditLogService, {} as never)
  }

  it('logAction глотает сбой: наблюдаемость не должна ронять бизнес-операцию', async () => {
    const facade = makeFacade(async () => {
      throw new Error('audit down')
    })

    await expect(
      facade.logAction({ actorType: 'system', actorId: 's', action: 'x' }),
    ).resolves.toBeUndefined()
  })

  it('logActionStrict тот же сбой отдаёт наружу — так maintenance теряет ключ дедупа звонко', async () => {
    const facade = makeFacade(async () => {
      throw new Error('audit down')
    })

    await expect(
      facade.logActionStrict({ actorType: 'system', actorId: 's', action: 'x' }),
    ).rejects.toThrow('audit down')
  })

  it('успешная запись проходит в обоих вариантах одним и тем же вызовом сервиса', async () => {
    const log = vi.fn().mockResolvedValue(undefined)
    const facade = makeFacade(log)
    const input = { actorType: 'system' as const, actorId: 's', action: 'x' }

    await facade.logAction(input)
    await facade.logActionStrict(input)

    expect(log.mock.calls).toEqual([[input], [input]])
  })
})

describe('maintenance заказывает записи, а не делает их', () => {
  function makePaymentRepo(flipped: boolean) {
    const expirePendingPayment = vi.fn().mockResolvedValue(flipped)
    const repo = new PrismaMaintenanceRepo({
      expirePendingPayment,
    } as unknown as PaymentsFacade)
    return { repo, expirePendingPayment }
  }

  it('expire-deposits: один заказ по id, без прisma-записи здесь', async () => {
    const { repo, expirePendingPayment } = makePaymentRepo(true)

    await repo.markExpired('pr-3')

    expect(expirePendingPayment.mock.calls).toEqual([['pr-3']])
    expect(paymentUpdateMany).not.toHaveBeenCalled()
  })

  it('expire-deposits: ноль обновлённых = доменная ошибка maintenance', async () => {
    const { repo } = makePaymentRepo(false)

    await expect(repo.markExpired('pr-4')).rejects.toBeInstanceOf(PaymentRequestNotPendingError)
  })

  it('withdrawal-reminder: строку аудита пишет admin, набор полей прежний', async () => {
    const logActionStrict = vi.fn().mockResolvedValue(undefined)
    const repo = new PrismaReminderAuditRepo({
      logActionStrict,
    } as unknown as AdminFacade)

    await repo.recordReminder({ targetId: 'pr-5', adminsNotified: 2, count: 5 })

    expect(logActionStrict).toHaveBeenCalledWith({
      actorType: 'system',
      actorId: '00000000-0000-0000-0000-000000000000',
      action: 'maintenance.withdrawal_reminder',
      targetType: 'payment_request',
      targetId: 'pr-5',
      payload: { adminsNotified: 2, totalStale: 5 },
    })
  })

  it('withdrawal-reminder: сбой записи летит наружу (строка — ключ дедупа)', async () => {
    const repo = new PrismaReminderAuditRepo({
      logActionStrict: vi.fn().mockRejectedValue(new Error('audit db down')),
    } as unknown as AdminFacade)

    await expect(
      repo.recordReminder({ targetId: 'pr-6', adminsNotified: 1, count: 1 }),
    ).rejects.toThrow('audit db down')
  })

  it('cleanup-sessions: джоба заказывает уборку и получает число удалённых', async () => {
    const cutoff = new Date('2026-09-26T00:00:00.000Z')
    const purgeDeadSessions = vi.fn().mockResolvedValue(7)
    const repo = new PrismaSessionMaintenanceRepo({
      purgeDeadSessions,
    } as unknown as UsersFacade)

    await expect(repo.purgeDeadSessions(cutoff)).resolves.toBe(7)
    expect(purgeDeadSessions.mock.calls).toEqual([[cutoff]])
    expect(sessionDeleteMany).not.toHaveBeenCalled()
  })
})
