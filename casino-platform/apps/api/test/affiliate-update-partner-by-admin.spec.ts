/**
 * G21-спек UpdateAffiliateByAdminUseCase (UC-AFF-18/19, В3).
 *
 * До переноса `affiliate-admin.controller.ts` читал партнёра «до», сам разбирал
 * ставку и сам вызывал `affiliates.update` — то есть presentation-слой и читал
 * бизнес-решение, и писал.
 *
 * Проверяются сохранённые контракты эндпоинта PATCH /admin/affiliate/partners/:id:
 *  - 404 `AFFILIATE_NOT_FOUND`, если партнёра нет (было так же — через
 *    `requireAffiliate`), и записи при этом нет;
 *  - ставка разбирается в application и нормализуется до 4 знаков;
 *  - аудит-экшен выбирается по признаку «ставка была В ЗАПРОСЕ» (прежний
 *    предикат `body.revshareRate !== undefined`), а не по сравнению до/после:
 *    смена ставки — отдельное регуляторное событие (ТЗ ч.8 §11.2);
 *  - снимок «до» возвращается для пары from/to в аудите.
 */
import { describe, expect, it } from 'vitest'

import { UpdateAffiliateByAdminUseCase } from '../src/modules/affiliate/application/use-cases/update-affiliate-by-admin.use-case'
import {
  AffiliateNotFoundError,
  AffiliateRateOutOfRangeError,
} from '../src/modules/affiliate/domain/errors/affiliate.errors'

import type { AffiliateEntity } from '../src/modules/affiliate/domain/entities/affiliate.entity'
import type {
  AffiliateRepository,
  UpdateAffiliateAdminInput,
} from '../src/modules/affiliate/domain/repositories/affiliate.repository'

function makeAffiliate(overrides: Partial<AffiliateEntity> = {}): AffiliateEntity {
  return {
    id: 'aff-1',
    userId: 'u-aff-1',
    email: 'partner@example.com',
    status: 'active',
    trackingCode: 'SPIN777',
    revshareRate: '0.2000',
    totalEarned: '0',
    ...overrides,
  } as unknown as AffiliateEntity
}

function makeDeps(options: { existing?: AffiliateEntity | null; updateError?: Error } = {}) {
  const updates: Array<{ id: string; changes: UpdateAffiliateAdminInput }> = []
  const repository = {
    findById: async () => (options.existing === undefined ? makeAffiliate() : options.existing),
    update: async (id: string, changes: UpdateAffiliateAdminInput) => {
      updates.push({ id, changes })
      if (options.updateError !== undefined) {
        throw options.updateError
      }
      return makeAffiliate({
        status: changes.status ?? 'active',
        revshareRate: changes.revshareRate ?? '0.2000',
      })
    },
  } as unknown as AffiliateRepository

  return { useCase: new UpdateAffiliateByAdminUseCase(repository), updates }
}

describe('UpdateAffiliateByAdminUseCase', () => {
  it('ставка в запросе: нормализуется, помечается rateRequested, снимок «до» возвращается', async () => {
    const { useCase, updates } = makeDeps()

    const result = await useCase.execute({
      affiliateId: 'aff-1',
      changes: { revshareRate: '0.3' },
    })

    expect(updates[0]?.changes).toEqual({ revshareRate: '0.3000' })
    expect(result.rateRequested).toBe(true)
    expect(result.previous).toEqual({ revshareRate: '0.2000', status: 'active' })
    expect(result.affiliate.revshareRate).toBe('0.3000')
  })

  it('обновление анкеты без ставки → rateRequested = false (аудит-экшен partner.updated)', async () => {
    const { useCase, updates } = makeDeps()

    const result = await useCase.execute({
      affiliateId: 'aff-1',
      changes: { telegram: '@partner', suspendedReason: null },
    })

    expect(result.rateRequested).toBe(false)
    expect(updates[0]?.changes).toEqual({ telegram: '@partner', suspendedReason: null })
    expect(updates[0]?.changes.revshareRate).toBeUndefined()
  })

  it('партнёра нет → AffiliateNotFoundError, репозиторий не трогается', async () => {
    const { useCase, updates } = makeDeps({ existing: null })

    await expect(
      useCase.execute({ affiliateId: 'ghost', changes: { status: 'suspended' } }),
    ).rejects.toBeInstanceOf(AffiliateNotFoundError)
    expect(updates).toHaveLength(0)
  })

  it('ставка вне диапазона → AffiliateRateOutOfRangeError ДО записи (мусор не уходит в БД)', async () => {
    const { useCase, updates } = makeDeps()

    await expect(
      useCase.execute({ affiliateId: 'aff-1', changes: { revshareRate: '7' } }),
    ).rejects.toBeInstanceOf(AffiliateRateOutOfRangeError)
    expect(updates).toHaveLength(0)
  })

  it('отказ порта пробрасывается наверх', async () => {
    const { useCase } = makeDeps({ updateError: new Error('db down') })

    await expect(
      useCase.execute({ affiliateId: 'aff-1', changes: { status: 'rejected' } }),
    ).rejects.toThrow('db down')
  })

  it('id для записи берётся из найденной сущности (несовпадение с параметром маршрута исключено)', async () => {
    const { useCase, updates } = makeDeps({ existing: makeAffiliate({ id: 'aff-canonical' }) })

    await useCase.execute({ affiliateId: 'aff-canonical', changes: { status: 'suspended' } })

    expect(updates[0]?.id).toBe('aff-canonical')
  })
})
