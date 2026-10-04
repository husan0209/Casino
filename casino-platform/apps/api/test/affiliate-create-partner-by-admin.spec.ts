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
 * Компенсирующее удаление user-записи при отказе записи партнёра — как в
 * `RegisterAffiliateUseCase`: иначе в `users` оставалась бы сирота.
 *
 * GAP-62: создание и удаление служебной учётки больше НЕ идут через порт
 * affiliate (прямой write в чужую таблицу `users`) — только через
 * `UsersFacade`. В порту остались чтения (`referral_code`), легальные по
 * ADR GAP-51, поэтому мок фасада и мок порта живут отдельно.
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
    provisionError?: Error
    deprovisionError?: Error
  } = {},
) {
  const created: CreatedAffiliate[] = []
  const playersProvisioned: Array<{ referralCode: string }> = []
  const playersDeprovisioned: string[] = []

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

  // ЧТЕНИЕ чужих таблиц — порт affiliate (ADR GAP-51): свободен ли referral_code.
  const players = {
    isPlayerReferralCodeAvailable: options.referralCodeAvailable ?? (async () => true),
  }

  // WRITE в `users` — только фасад владельца данных (GAP-62).
  const users = {
    provisionAffiliatePlayer: async (args: { referralCode: string }) => {
      if (options.provisionError !== undefined) {
        throw options.provisionError
      }
      playersProvisioned.push(args)
      return { id: 'partner-player-1' }
    },
    deprovisionAffiliatePlayer: async (userId: string) => {
      if (options.deprovisionError !== undefined) {
        throw options.deprovisionError
      }
      playersDeprovisioned.push(userId)
    },
  }

  const settings = {
    get: async () => ({ ...AFFILIATE_SETTINGS_DEFAULTS, ...options.settings }),
  }

  const useCase = new CreateAffiliateByAdminUseCase(
    affiliates as never,
    players as never,
    settings as never,
    users as never,
  )

  return { useCase, created, playersProvisioned, playersDeprovisioned }
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
    const { useCase, created, playersProvisioned } = makeDeps()

    await useCase.execute(BASE_INPUT)

    expect(playersProvisioned).toHaveLength(1)
    expect(String(playersProvisioned[0]?.referralCode)).toMatch(
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

  it('отказ записи партнёра компенсируется удалением user-записи (сирота не остаётся)', async () => {
    const boom = new Error('unique violation on email')
    const { useCase, playersProvisioned, playersDeprovisioned } = makeDeps({ createError: boom })

    await expect(useCase.execute(BASE_INPUT)).rejects.toBe(boom)
    // Сирота закрывается ровно тем id, который вернул провижининг.
    expect(playersProvisioned).toHaveLength(1)
    expect(playersDeprovisioned).toEqual(['partner-player-1'])
  })

  it('отказ самого compensate не перекрывает первопричину: наружу идёт ошибка create', async () => {
    const boom = new Error('unique violation on email')
    const { useCase, playersDeprovisioned } = makeDeps({
      createError: boom,
      deprovisionError: new Error('users недоступны'),
    })

    await expect(useCase.execute(BASE_INPUT)).rejects.toBe(boom)
    expect(playersDeprovisioned).toEqual([])
  })

  it('успешное создание партнёра НЕ удаляет служебную учётку', async () => {
    const { useCase, playersDeprovisioned } = makeDeps()

    await useCase.execute(BASE_INPUT)

    expect(playersDeprovisioned).toEqual([])
  })

  it('все кандидаты referral_code заняты → PlayerReferralCodeGenerationError, партнёр не создаётся', async () => {
    const { useCase, created, playersProvisioned } = makeDeps({
      referralCodeAvailable: async () => false,
    })

    await expect(useCase.execute(BASE_INPUT)).rejects.toBeInstanceOf(
      PlayerReferralCodeGenerationError,
    )
    expect(created).toHaveLength(0)
    expect(playersProvisioned).toHaveLength(0)
  })

  it('отказ провижининга (конфликт уникальности в users) — партнёр не создаётся', async () => {
    // Коллизия referral_code между проверкой «свободен» и INSERT: ошибку
    // не глотаем и compensating delete не зовём — удалять нечего.
    const conflict = new Error('Unique constraint failed on the fields: (`referral_code`)')
    const { useCase, created, playersDeprovisioned } = makeDeps({ provisionError: conflict })

    await expect(useCase.execute(BASE_INPUT)).rejects.toBe(conflict)
    expect(created).toHaveLength(0)
    expect(playersDeprovisioned).toEqual([])
  })

  it('ставка вне [0,1] → AffiliateRateOutOfRangeError до каких-либо записей', async () => {
    const { useCase, created, playersProvisioned } = makeDeps()

    await expect(useCase.execute({ ...BASE_INPUT, revshareRate: '1.5' })).rejects.toBeInstanceOf(
      AffiliateRateOutOfRangeError,
    )
    expect(created).toHaveLength(0)
    expect(playersProvisioned).toHaveLength(0)
  })
})
