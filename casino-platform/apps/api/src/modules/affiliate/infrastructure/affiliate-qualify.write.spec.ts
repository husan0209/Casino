/**
 * Запись квалификации (F4, ТЗ ч.8 §13.2): что именно уходит в
 * `affiliate_attribution`.
 *
 * Проверямое — связь «флаг есть, отказа нет». Квалифицированная строка с
 * `reject_reason` выглядит в админке как отказавшая, и это ровно то место,
 * где правило могло бы начать молча резать партнёрам комиссии: статус и
 * причина пишутся в одном `update`, а суточный расчёт фильтрует по статусу.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

const update = vi.fn<(args: unknown) => Promise<unknown>>()

vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return {
    ...actual,
    prisma: {
      affiliateAttribution: {
        update: (args: unknown): Promise<unknown> => update(args),
      },
    },
  }
})

import { PrismaAffiliateAttributionRepository } from './affiliate.prisma.repository'

import type { QualifyAttributionInput } from '../domain/repositories/affiliate.repository'

const repo = new PrismaAffiliateAttributionRepository()

/** Строка, которую Prisma отдаёт после update: то, что в него записали. */
function attributedRow(data: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'attr-1',
    affiliateId: 'aff-1',
    playerId: 'player-1',
    clickId: null,
    status: data['status'],
    qualifiedAt: data['qualifiedAt'],
    firstDepositId: data['firstDepositId'],
    firstDepositAt: data['firstDepositAt'],
    totalDeposit: data['totalDeposit'],
    depositCount: data['depositCount'],
    isSelfReferral: false,
    rejectReason: data['rejectReason'] ?? null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

function updateData(): Record<string, unknown> {
  const args = update.mock.calls[0]![0] as { data: Record<string, unknown> }
  return args.data
}

const base: QualifyAttributionInput = {
  id: 'attr-1',
  firstDepositId: 'pay-1',
  firstDepositAt: new Date('2026-06-01T00:00:00.000Z'),
  totalDeposit: '500.00000000',
  depositCount: 1,
}

beforeEach(() => {
  update.mockReset()
  update.mockImplementation(async (args: unknown) => {
    const { data } = args as { data: Record<string, unknown> }
    return attributedRow(data)
  })
})

describe('PrismaAffiliateAttributionRepository.qualify — флаг на разбор', () => {
  it('пишет причину, оставляя статус qualified', async () => {
    await repo.qualify({ ...base, reviewReason: 'near_threshold_deposit' })

    const data = updateData()
    expect(data['rejectReason']).toBe('near_threshold_deposit')
    // то, ради чего правило не блокирует: начисления идут по статусу
    expect(data['status']).toBe('qualified')
    expect(data['depositCount']).toBe(1)
  })

  it('без флага очищает причину, а не оставляет её от прошлого решения', async () => {
    await repo.qualify({ ...base, reviewReason: null })

    expect(updateData()['rejectReason']).toBeNull()
  })

  it('не трогает колонку причины, когда use case вовсе её не передал', async () => {
    // Квалификация из другого места (не job) не должна терпеть флаг чужого
    // решения молча: отсутствие ключа = «не пишем», а не «пишем null»
    await repo.qualify(base)

    expect(Object.hasOwn(updateData(), 'rejectReason')).toBe(false)
  })

  it('переносит накопленное из первоисточника, а не из колонки атрибуции', async () => {
    await repo.qualify({
      ...base,
      totalDeposit: '1234.5',
      depositCount: 3,
      firstDepositId: 'pay-9',
      reviewReason: 'near_threshold_deposit',
    })

    const data = updateData()
    expect((data['totalDeposit'] as { toFixed: (digits: number) => string }).toFixed(8)).toBe(
      '1234.50000000',
    )
    expect(data['depositCount']).toBe(3)
    expect(data['firstDepositId']).toBe('pay-9')
    expect(data['qualifiedAt']).toBeInstanceOf(Date)
  })
})
