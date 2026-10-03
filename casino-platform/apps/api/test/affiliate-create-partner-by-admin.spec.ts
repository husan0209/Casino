/**
 * G21-спек CreateAffiliateByAdminUseCase (UC-AFF-17, В3).
 *
 * Сценарий раньше жил прямо в `AffiliateAdminController.createPartner` и писал
 * в БД из presentation-слоя. Вместе с переносом исправлены два дефекта
 * поведения, поэтому они проверяются отдельно:
 *  - `userId` больше НЕ берётся из `admin.id`: партнёру создаётся своя
 *    user-запись. `affiliates.user_id` — FK на `users.id` под `@unique`, и с
 *    id администратора эндпоинт падал на нарушении внешнего ключа (500), а
 *    при удачном стечении обстоятельств начисления уходили бы в кошелёк
 *    администратора;
 *  - пароль из запроса хешируется argon2id: раньше в БД ложилась пустая
 *    строка, и партнёр не мог войти в кабинет никогда.
 *
 * Сэмпл для фейков портов — `test/auth-register.spec.ts` /
 * `affiliate/application/use-cases/register-affiliate.use-case.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateAffiliateByAdminUseCase } from '../src/modules/affiliate/application/use-cases/create-affiliate-by-admin.use-case'
import { AFFILIATE_SETTINGS_DEFAULTS } from '../src/modules/affiliate/domain/affiliate-settings'
import {
  AffiliateRateOutOfRangeError,
  PlayerReferralCodeGenerationError,
} from '../src/modules/affiliate/domain/errors/affiliate.errors'

import type { AffiliateSettings } from '../src/modules/affiliate/domain/affiliate-settings'
import type { AffiliateEntity } from '../src/modules/affiliate/domain/entities/affiliate.entity'
import type { CreateAffiliateInput } from '../src/modules/affiliate/domain/repositories/affiliate.repository'

const { hashMock } = vi.hoisted(() => ({
  hashMock: vi.fn(async (_plain: string, _options?: unknown): Promise<string> => 'argon2-hash'),
}))

vi.mock('argon2', () => ({
  hash: (plain: string, options?: unknown) => hashMock(plain, options),
  argon2id: 2,
}))

/** Аргон2-опция type=argon2id в мок-модуле — число 2 (как в @node-argon2). */
const ARGON2_ID = 2

interface CreatedAffiliate {
  id: string
  userId: string
  email: string
  passwordHash: string
  trackingCode: string
  revshareRate: string
  payoutCurrency: string
  isAgreed: boolean
  displayName: string | null
  country: string | null
}

function makeDeps(
  options: {
    settings?: Partial<AffiliateSettings>
    referralCodeAvailable?: (code: string) => Promise<boolean>
    createError?: Error
  } = {},
) {
  const created: CreatedAffiliate[] = []
  const playersCreated: Array<{ referralCode: string }> = []
  const playersDeleted: string[] = []

  const affiliates = {
    generateUniqueTrackingCode: async () => 'TRK12345',
    create: async (input: CreateAffiliateInput) => {
      const row: CreatedAffiliate = {
        id: 'aff-new',
        userId: input.userId,
        email: input.email,
        passwordHash: input.passwordHash,
        trackingCode: input.trackingCode,
        revshareRate: input.revshareRate,
        payoutCurrency: input.payoutCurrency,
        isAgreed: input.isAgreed,
        displayName: input.displayName ?? null,
        country: input.country ?? null,
      }
      created.push(row)
      if (options.createError !== undefined) {
        throw options.createError
      }
      return row as unknown as AffiliateEntity
    },
  }

  const players = {
    createPlayerUser: async (args: { referralCode: string }) => {
      playersCreated.push(args)
      return { id: 'partner-player-1' }
    },
    deletePlayerUser: async (userId: string) => {
      playersDeleted.push(userId)
    },
    isPlayerReferralCodeAvailable: options.referralCodeAvailable ?? (async () => true),
  }

  const settings = {
    get: async () => ({ ...AFFILIATE_SETTINGS_DEFAULTS, ...options.settings }),
  }

  const useCase = new CreateAffiliateByAdminUseCase(
    affiliates as never,
    players as never,
    settings as never,
  )

  return { useCase, created, playersCreated, playersDeleted }
}

const BASE_INPUT = {
  email: 'Offline.Partner@Example.COM',
  password: 'Sup3rSecret!',
  payoutCurrency: 'RUB',
}

describe('CreateAffiliateByAdminUseCase', () => {
  beforeEach(() => {
    hashMock.mockClear()
  })

  it('партнёр создаётся со СВОЕЙ user-записью, а не с id администратора', async () => {
    const { useCase, created, playersCreated } = makeDeps()

    await useCase.execute(BASE_INPUT)

    expect(playersCreated).toHaveLength(1)
    expect(String(playersCreated[0]?.referralCode)).toMatch(
      /^aff[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/,
    )
    expect(created[0]?.userId).toBe('partner-player-1')
    expect(created[0]?.userId).not.toBe('admin-user-1')
  })

  it('пароль хешируется argon2id, а не пишется пустой строкой', async () => {
    const { useCase, created } = makeDeps()

    await useCase.execute(BASE_INPUT)

    expect(hashMock).toHaveBeenCalledTimes(1)
    expect(hashMock.mock.calls[0]?.[0]).toBe('Sup3rSecret!')
    expect((hashMock.mock.calls[0]?.[1] as { type: number }).type).toBe(ARGON2_ID)
    expect(created[0]?.passwordHash).toBe('argon2-hash')
    expect(created[0]?.passwordHash).not.toBe('')
  })

  it('ставка не задана — берётся ставка программы по умолчанию, согласие проставлено', async () => {
    const { useCase, created } = makeDeps({ settings: { defaultRevshareRate: '0.2500' } })

    await useCase.execute(BASE_INPUT)

    expect(created[0]).toMatchObject({ revshareRate: '0.2500', isAgreed: true })
  })

  it('ставка задана — нормализуется до 4 знаков; email приводится к нижнему регистру', async () => {
    const { useCase, created } = makeDeps()

    await useCase.execute({ ...BASE_INPUT, revshareRate: '.35', displayName: 'Оффлайн-партнёр' })

    expect(created[0]).toMatchObject({
      revshareRate: '0.3500',
      email: 'offline.partner@example.com',
      trackingCode: 'TRK12345',
      payoutCurrency: 'RUB',
      displayName: 'Оффлайн-партнёр',
      country: null,
    })
  })

  it('отказ записи партнёра компенсируется удалением user-записи', async () => {
    const boom = new Error('unique violation on email')
    const { useCase, playersDeleted } = makeDeps({ createError: boom })

    await expect(useCase.execute(BASE_INPUT)).rejects.toBe(boom)
    expect(playersDeleted).toEqual(['partner-player-1'])
  })

  it('все кандидаты referral_code заняты → PlayerReferralCodeGenerationError, партнёр не создаётся', async () => {
    const { useCase, created, playersCreated } = makeDeps({
      referralCodeAvailable: async () => false,
    })

    await expect(useCase.execute(BASE_INPUT)).rejects.toBeInstanceOf(
      PlayerReferralCodeGenerationError,
    )
    expect(created).toHaveLength(0)
    expect(playersCreated).toHaveLength(0)
  })

  it('ставка вне [0,1] → AffiliateRateOutOfRangeError до каких-либо записей', async () => {
    const { useCase, created, playersCreated } = makeDeps()

    await expect(useCase.execute({ ...BASE_INPUT, revshareRate: '1.5' })).rejects.toBeInstanceOf(
      AffiliateRateOutOfRangeError,
    )
    expect(created).toHaveLength(0)
    expect(playersCreated).toHaveLength(0)
  })
})
