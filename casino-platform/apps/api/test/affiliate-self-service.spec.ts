/**
 * G21-спек self-service сценариев кабинета партнёра (В3).
 *
 * Покрывает сразу два перенесённых из `affiliate.controller.ts` сценария:
 *  - UpdateAffiliateProfileUseCase (UC-AFF-15): партнёр правит ТОЛЬКО контакты;
 *  - LeaveAffiliateProgramUseCase (UC-AFF-16): выход из программы.
 *
 * Инварианты, которые проверяются:
 *  - owner-check: id партнёра берётся из JWT (аргумент сценария), 404
 *    `AFFILIATE_NOT_FOUND` сохраняется (прежний `requireAffiliate` в
 *    контроллере делал то же самое);
 *  - ставку/статус self-service не может изменить — в порт уходит только
 *    UpdateAffiliateSelfInput (три поля), и тест это фиксирует;
 *  - выход = `suspended` + причина `self-service leave` (не `rejected`:
 *    партнёр может вернуться, накопленная статистика не удаляется).
 */
import { describe, expect, it } from 'vitest'

import { LeaveAffiliateProgramUseCase } from '../src/modules/affiliate/application/use-cases/leave-affiliate-program.use-case'
import { UpdateAffiliateProfileUseCase } from '../src/modules/affiliate/application/use-cases/update-affiliate-profile.use-case'
import { AffiliateNotFoundError } from '../src/modules/affiliate/domain/errors/affiliate.errors'

import type { AffiliateEntity } from '../src/modules/affiliate/domain/entities/affiliate.entity'
import type {
  AffiliateRepository,
  UpdateAffiliateAdminInput,
  UpdateAffiliateSelfInput,
} from '../src/modules/affiliate/domain/repositories/affiliate.repository'

function makeAffiliate(overrides: Partial<AffiliateEntity> = {}): AffiliateEntity {
  return {
    id: 'aff-1',
    userId: 'u-aff-1',
    email: 'partner@example.com',
    status: 'active',
    revshareRate: '0.2000',
    displayName: 'Партнёр',
    telegram: null,
    website: null,
    ...overrides,
  } as unknown as AffiliateEntity
}

function makeDeps(options: { existing?: AffiliateEntity | null; failWith?: Error } = {}) {
  const selfWrites: Array<{ id: string; changes: UpdateAffiliateSelfInput }> = []
  const adminWrites: Array<{ id: string; changes: UpdateAffiliateAdminInput }> = []

  const repository = {
    findById: async () => (options.existing === undefined ? makeAffiliate() : options.existing),
    updateSelf: async (id: string, changes: UpdateAffiliateSelfInput) => {
      if (options.failWith !== undefined) {
        throw options.failWith
      }
      selfWrites.push({ id, changes })
      // exactOptionalPropertyTypes: Partial<AffiliateEntity> не принимает
      // undefined, поэтому undefined из входных изменений сворачивается в null.
      return makeAffiliate({
        displayName: changes.displayName ?? null,
        telegram: changes.telegram ?? null,
        website: changes.website ?? null,
      })
    },
    update: async (id: string, changes: UpdateAffiliateAdminInput) => {
      if (options.failWith !== undefined) {
        throw options.failWith
      }
      adminWrites.push({ id, changes })
      return makeAffiliate({
        status: changes.status ?? 'active',
        suspendedReason: changes.suspendedReason ?? null,
      })
    },
  } as unknown as AffiliateRepository

  return {
    repository,
    selfWrites,
    adminWrites,
    profileUseCase: new UpdateAffiliateProfileUseCase(repository),
    leaveUseCase: new LeaveAffiliateProgramUseCase(repository),
  }
}

describe('UpdateAffiliateProfileUseCase', () => {
  it('партнёр меняет контакты: в порт уходят только три поля анкеты', async () => {
    const { profileUseCase, selfWrites } = makeDeps()

    const updated = await profileUseCase.execute({
      affiliateId: 'aff-1',
      changes: { displayName: 'Новое имя', telegram: '@partner', website: null },
    })

    expect(selfWrites).toHaveLength(1)
    expect(selfWrites[0]?.id).toBe('aff-1')
    expect(Object.keys(selfWrites[0]?.changes ?? {}).sort()).toEqual([
      'displayName',
      'telegram',
      'website',
    ])
    expect(updated.displayName).toBe('Новое имя')
  })

  it('партнёра нет → 404 AFFILIATE_NOT_FOUND, записи нет', async () => {
    const { profileUseCase, selfWrites } = makeDeps({ existing: null })

    await expect(
      profileUseCase.execute({ affiliateId: 'ghost', changes: { telegram: '@x' } }),
    ).rejects.toBeInstanceOf(AffiliateNotFoundError)
    expect(selfWrites).toHaveLength(0)
  })

  it('краевой случай: пустое тело — вызов в порт без изменений полей', async () => {
    const { profileUseCase, selfWrites } = makeDeps()

    await profileUseCase.execute({ affiliateId: 'aff-1', changes: {} })

    expect(selfWrites[0]?.changes).toEqual({})
  })

  it('отказ порта пробрасывается (presentation не «глотает» ошибку)', async () => {
    const { profileUseCase } = makeDeps({ failWith: new Error('db down') })

    await expect(
      profileUseCase.execute({ affiliateId: 'aff-1', changes: { telegram: '@x' } }),
    ).rejects.toThrow('db down')
  })
})

describe('LeaveAffiliateProgramUseCase', () => {
  it('выход: статус suspended + фиксированная причина, начисления не отзываются', async () => {
    const { leaveUseCase, adminWrites } = makeDeps()

    await leaveUseCase.execute({ affiliateId: 'aff-1' })

    expect(adminWrites).toEqual([
      {
        id: 'aff-1',
        changes: { status: 'suspended', suspendedReason: 'self-service leave' },
      },
    ])
  })

  it('выход не делает партнёра rejected (он может вернуться) — возвращённая сущность suspended', async () => {
    const { leaveUseCase } = makeDeps()

    const result = await leaveUseCase.execute({ affiliateId: 'aff-1' })

    expect(result.status).toBe('suspended')
  })

  it('партнёра нет → 404, записи нет', async () => {
    const { leaveUseCase, adminWrites } = makeDeps({ existing: null })

    await expect(leaveUseCase.execute({ affiliateId: 'ghost' })).rejects.toBeInstanceOf(
      AffiliateNotFoundError,
    )
    expect(adminWrites).toHaveLength(0)
  })

  it('отказ порта пробрасывается', async () => {
    const { leaveUseCase } = makeDeps({ failWith: new Error('db down') })

    await expect(leaveUseCase.execute({ affiliateId: 'aff-1' })).rejects.toThrow('db down')
  })
})
