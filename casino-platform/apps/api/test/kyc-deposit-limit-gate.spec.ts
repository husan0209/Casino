/**
 * Юнит-тесты KycCheckService — денежного гейта KYC (слепая зона G21).
 *
 * Гард G21 следит только за `*.use-case.ts`, поэтому `application/*.service.ts`
 * остаются вне его радара: у KycCheckService не было ни одного теста. Здесь
 * закрыты ветки, где ошибка стоит денег, а не удобства:
 *  - approved-игрок обходится БЕЗ запроса сумм депозитов (иначе «проверка»
 *    платится лишним походом в БД на каждом депозите);
 *  - порог сравнения СТРОГО «больше»: депозит ровно до лимита разрешён, а
 *    1e-8 сверх — уже запрещён. Это держится только пока суммы идут через
 *    money.* на Decimal; при возврате к number граница перестанет ловиться;
 *  - отказ хранилища KYC = отказ и в депозите, и в выводе (fail-closed). Для
 *    assertCanWithdraw это единственный существующий guard, поэтому «тихий
 *    пропуск» при упавшем репозитории означал бы вывод без верификации.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KycCheckService } from '../src/modules/kyc/application/use-cases/kyc-check.service'
import { KycRequiredError } from '../src/modules/kyc/domain/errors'

import type { IKycRepository } from '../src/modules/kyc/domain/repositories/kyc.repository'
import type { ConfigService } from '@nestjs/config'

const USER_ID = 'u-kyc-1'
const DEFAULT_LIMIT = '5000'

type KycStatusView = Awaited<ReturnType<IKycRepository['getStatus']>>

const statusOf = (status: string): KycStatusView => ({
  status,
  submittedAt: new Date('2026-01-01T00:00:00.000Z'),
  rejectionReason: null,
  documents: [],
})

/** Порт KYC целиком in-memory: сервис использует только getStatus и сумму депозитов. */
function makeService() {
  const getStatus = vi.fn()
  const getTotalDepositedRub = vi.fn()
  const repo = { getStatus, getTotalDepositedRub }
  // GAP-72: сервис читает порог из конфига, а не из литерала. Заглушка отдаёт
  // тот же DEFAULT_LIMIT, что тесты передают третьим аргументом, — границы
  // «строго больше» и fail-closed ветки проверяются ровно как раньше.
  const config = {
    get: (key: string) => (key === 'KYC_DEPOSIT_LIMIT_RUB' ? DEFAULT_LIMIT : undefined),
  }
  const service = new KycCheckService(
    repo as unknown as IKycRepository,
    config as unknown as ConfigService,
  )
  return { service, getStatus, getTotalDepositedRub }
}

let getStatus: ReturnType<typeof makeService>['getStatus']
let getTotalDepositedRub: ReturnType<typeof makeService>['getTotalDepositedRub']
let service: KycCheckService

beforeEach(() => {
  const made = makeService()
  service = made.service
  getStatus = made.getStatus
  getTotalDepositedRub = made.getTotalDepositedRub
  getStatus.mockReset().mockResolvedValue(null)
  getTotalDepositedRub.mockReset().mockResolvedValue('0')
})

describe('KycCheckService.assertCanDeposit — лимит без KYC', () => {
  it('approved не читает сумму депозитов вообще', async () => {
    // Arrange — верифицированный игрок вне лимита по определению
    getStatus.mockResolvedValue(statusOf('approved'))
    // Act
    await service.assertCanDeposit(USER_ID, '999999.99999999', DEFAULT_LIMIT)
    // Assert — обход обязан случиться ДО запроса к money-данным
    expect(getStatus).toHaveBeenCalledWith(USER_ID)
    expect(getTotalDepositedRub).not.toHaveBeenCalled()
  })

  it('pending под лимитом проходит', async () => {
    // Arrange
    getStatus.mockResolvedValue(statusOf('pending'))
    getTotalDepositedRub.mockResolvedValue('4000')
    // Act/Assert
    await expect(service.assertCanDeposit(USER_ID, '1000', DEFAULT_LIMIT)).resolves.toBeUndefined()
  })

  it('сумма ровно до лимита разрешена (сравнение строгое)', async () => {
    // Arrange — 4500 + 500 = 5000, что не «больше» лимита
    getTotalDepositedRub.mockResolvedValue('4500.00000000')
    // Act/Assert
    await expect(
      service.assertCanDeposit(USER_ID, '500.00000000', DEFAULT_LIMIT),
    ).resolves.toBeUndefined()
  })

  it('младший разряд 1e-8 сверх лимита уже запрещает депозит', async () => {
    // Arrange — Decimal-арифметика обязана увидеть 5000.00000001 > 5000
    getTotalDepositedRub.mockResolvedValue('4500')
    // Act
    const attempt = service.assertCanDeposit(USER_ID, '500.00000001', DEFAULT_LIMIT)
    // Assert
    await expect(attempt).rejects.toBeInstanceOf(KycRequiredError)
    // Код с #163 точный: DEPOSIT_LIMIT_EXCEEDED (наследник KycRequiredError),
    // чтобы клиент различал «пройди верификацию» и «упёрся в лимит без неё».
    // instanceof выше остаётся проверкой общей ветки «нужен KYC».
    await expect(attempt).rejects.toMatchObject({
      code: 'DEPOSIT_LIMIT_EXCEEDED',
      httpStatus: 422,
    })
  })

  it('профиль отсутствует (getStatus = null) — считается не-verified', async () => {
    // Arrange
    getStatus.mockResolvedValue(null)
    getTotalDepositedRub.mockResolvedValue('5001')
    // Act/Assert
    await expect(service.assertCanDeposit(USER_ID, '1', DEFAULT_LIMIT)).rejects.toThrow(
      KycRequiredError,
    )
  })

  it('пустая строка суммы трактуется как 0, а не как NaN', async () => {
    // Arrange — репозиторий вернул '' вместо '0'
    getTotalDepositedRub.mockResolvedValue('')
    // Act/Assert — иначе money.add('') вылил бы NaN и молча пропустил всё
    await expect(service.assertCanDeposit(USER_ID, '5000', DEFAULT_LIMIT)).resolves.toBeUndefined()
  })

  it('переданный limitRub перекрывает дефолт', async () => {
    // Arrange — дефолтные 5000 пропустили бы эту сумму
    getTotalDepositedRub.mockResolvedValue('100')
    // Act/Assert
    await expect(service.assertCanDeposit(USER_ID, '100', '50')).rejects.toThrow(KycRequiredError)
  })

  it('отказ getStatus блокирует депозит (fail-closed)', async () => {
    // Arrange
    getStatus.mockRejectedValue(new Error('connection lost'))
    // Act/Assert
    await expect(service.assertCanDeposit(USER_ID, '10', DEFAULT_LIMIT)).rejects.toThrow(
      'connection lost',
    )
    expect(getTotalDepositedRub).not.toHaveBeenCalled()
  })
})

describe('KycCheckService.assertCanWithdraw — вывод только для approved', () => {
  it('approved выводит', async () => {
    // Arrange
    getStatus.mockResolvedValue(statusOf('approved'))
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID)).resolves.toBeUndefined()
  })

  it('pending отказывает', async () => {
    // Arrange
    getStatus.mockResolvedValue(statusOf('pending'))
    // Act
    const attempt = service.assertCanWithdraw(USER_ID)
    // Assert
    await expect(attempt).rejects.toBeInstanceOf(KycRequiredError)
    await expect(attempt).rejects.toMatchObject({ code: 'KYC_REQUIRED' })
  })

  it('отказ хранилища не открывает вывод (fail-closed)', async () => {
    // Arrange — единственный guard вывода: падение порта не должно значить «пропустили»
    getStatus.mockRejectedValue(new Error('kyc store down'))
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID)).rejects.toThrow('kyc store down')
  })
})
