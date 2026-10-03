/**
 * Юнит-тесты KycAdminService — карточки и решения модератора KYC (слепая зона G21).
 *
 * Сервис почти целиком делегирует порту (и это честно зафиксировано ниже —
 * «имитацией теста» такие проверки не являются, они держат только контракт
 * вызова). Реальная логика тут в одном месте — `getWithTotalDeposited`:
 *  - для несуществующего профиля money-запрос обязан НЕ выполняться;
 *  - сумма депозитов проходит наружу СТРОКОЙ без приведения к number;
 *  - при отказе money-запроса карточка всё равно отдаётся, а сумма молча
 *    становится '0'. Это зафиксированное текущее поведение, а не одобрение:
 *    модератор не может отличить «депозитов не было» от «БД не ответила», и
 *    на этом основании можно одобрить KYC. См. раздел «Подозрения» в отчёте
 *    — менять поведение в рамках тестовой задачи нельзя.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KycAdminService } from '../src/modules/kyc/application/use-cases/kyc-admin.service'

import type {
  IKycRepository,
  KycProfileRow,
} from '../src/modules/kyc/domain/repositories/kyc.repository'

const PROFILE_ID = 'kyc-profile-1'
const PLAYER_ID = 'u-kyc-1'

const profileRow: KycProfileRow = {
  id: PROFILE_ID,
  userId: PLAYER_ID,
  status: 'pending',
  firstName: 'Иван',
  lastName: 'Петров',
  dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
  country: 'RU',
  documentType: 'passport',
  documentNumber: 'AF123456',
  rejectionReason: null,
  submittedAt: new Date('2026-05-01T00:00:00.000Z'),
  approvedAt: null,
  rejectedAt: null,
}

let getById: ReturnType<typeof vi.fn>
let getTotalDepositedRub: ReturnType<typeof vi.fn>
let listAdmin: ReturnType<typeof vi.fn>
let setStatus: ReturnType<typeof vi.fn>
let service: KycAdminService

beforeEach(() => {
  getById = vi.fn().mockResolvedValue(profileRow)
  getTotalDepositedRub = vi.fn().mockResolvedValue('0')
  listAdmin = vi.fn().mockResolvedValue({ items: [profileRow], total: 1 })
  setStatus = vi.fn().mockResolvedValue(undefined)
  const repo = { getById, getTotalDepositedRub, listAdmin, setStatus }
  service = new KycAdminService(repo as unknown as IKycRepository)
})

describe('KycAdminService.getWithTotalDeposited — карточка модератора', () => {
  it('несуществующий профиль → null, и money-запрос не выполняется', async () => {
    // Arrange
    getById.mockResolvedValue(null)
    // Act
    const card = await service.getWithTotalDeposited('missing-id')
    // Assert — обогащать деньгами нечего, второй запрос лишний
    expect(card).toBeNull()
    expect(getTotalDepositedRub).not.toHaveBeenCalled()
  })

  it('сумма депозитов проходит наружу строкой без приведения к number', async () => {
    // Arrange
    getTotalDepositedRub.mockResolvedValue('123456.78901234')
    // Act
    const card = await service.getWithTotalDeposited(PROFILE_ID)
    // Assert
    expect(getTotalDepositedRub).toHaveBeenCalledWith(PLAYER_ID)
    expect(card?.totalDepositedRub).toBe('123456.78901234')
    expect(card?.profile).toEqual(profileRow)
  })

  it('отказ money-запроса: карточка отдаётся, сумма молча становится нулём', async () => {
    // Arrange — fail-soft: модератор продолжит разбор, но не увидит разницы
    getTotalDepositedRub.mockRejectedValue(new Error('payments unreadable'))
    // Act
    const card = await service.getWithTotalDeposited(PROFILE_ID)
    // Assert — текущее поведение зафиксировано намеренно (см. шапку файла)
    expect(card?.totalDepositedRub).toBe('0')
    expect(card?.profile).toEqual(profileRow)
  })

  it('userId профиля, а не id карточки, уходит в запрос сумм', async () => {
    // Act
    await service.getWithTotalDeposited(PROFILE_ID)
    // Assert — перепутать ключи означало бы показать депозиты чужого игрока
    expect(getTotalDepositedRub.mock.calls[0]?.[0]).toBe(PLAYER_ID)
  })
})

describe('KycAdminService — список и решение', () => {
  it('list делегирует фильтр статуса и пагинацию порту', async () => {
    // Act
    await service.list('pending', 2, 50)
    // Assert — сервис не должен «дофильтровывать» в памяти
    expect(listAdmin).toHaveBeenCalledWith('pending', 2, 50)
  })

  it('list без фильтра → undefined статус, дефолтная пагинация', async () => {
    // Act
    await service.list()
    // Assert
    expect(listAdmin).toHaveBeenCalledWith(undefined, 1, 20)
  })

  it('decide пробрасывает причину и модератора как есть (аудит-след)', async () => {
    // Act
    await service.decide({
      id: PROFILE_ID,
      status: 'rejected',
      reason: 'документ нечитаем',
      reviewedBy: 'admin-7',
    })
    // Assert — ни потеря reason, ни подмена reviewedBy недопустимы
    expect(setStatus).toHaveBeenCalledWith({
      id: PROFILE_ID,
      status: 'rejected',
      reason: 'документ нечитаем',
      reviewedBy: 'admin-7',
    })
  })
})
