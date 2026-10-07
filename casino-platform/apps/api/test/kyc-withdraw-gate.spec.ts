/**
 * Юнит-тесты KycCheckService — гейта верификации на ВЫВОДЕ (слепая зона G21).
 *
 * Гард G21 следит только за `*.use-case.ts`, поэтому `application/*.service.ts`
 * остаются вне его радара. Здесь закрыты ветки, где ошибка стоит денег, а не
 * удобства:
 *  - одобренному игроку порога нет;
 *  - неверифицированному разрешён вывод до `KYC_WITHDRAW_LIMIT_RUB` **суммарно**,
 *    ровно порог включительно, 5 000 ₽ 1 ₽ — отказ (решение владельца 2026-10-07);
 *  - в базу порога попадает уже выведенное И замороженное pending-заявками —
 *    иначе правило обходится десятью заявками по 5 000 ₽;
 *  - отказ хранилища KYC или истории выводов НЕ открывает вывод (fail-closed):
 *    assertCanWithdraw — единственный guard вывода, поэтому «тихий пропуск» при
 *    упавшем репозитории означал бы выпуск средств неверифицированному игроку.
 *
 * Что здесь раньше лежало и удалено 2026-10-07: `assertCanDeposit` — шлюз
 * «суммарные пополнения до KYC_DEPOSIT_LIMIT_RUB». Верификация нужна на выводе,
 * а не на пополнении, поэтому у сервиса больше нет метода для депозита. Что
 * пополнение не ходит в KYC — закреплено в спеках `payments-create-fiat-deposit`
 * и `payments-create-crypto-deposit`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GeoFacade } from '@modules/geo/facade/geo.facade'

import { KycCheckService } from '../src/modules/kyc/application/use-cases/kyc-check.service'
import { KycRequiredError } from '../src/modules/kyc/domain/errors'

import type {
  CountedWithdrawal,
  IKycRepository,
} from '../src/modules/kyc/domain/repositories/kyc.repository'
import type { ConfigService } from '@nestjs/config'

const USER_ID = 'u-kyc-1'
const WITHDRAW_LIMIT = '5000'

type KycStatusView = Awaited<ReturnType<IKycRepository['getStatus']>>

const statusOf = (status: string): KycStatusView => ({
  status,
  submittedAt: new Date('2026-01-01T00:00:00.000Z'),
  rejectionReason: null,
  documents: [],
})

const row = (amountRub: string | null, currency = 'RUB', amount = '0'): CountedWithdrawal => ({
  currency,
  amount,
  amountRub,
})

/**
 * Порт KYC in-memory: сервис использует getStatus (статус) и
 * listCountedWithdrawals (база порога). getTotalDepositedRub нужен только
 * риск-логу депозитов — здесь он пустой по умолчанию.
 */
function makeService() {
  const getStatus = vi.fn()
  const listCountedWithdrawals = vi.fn()
  const getTotalDepositedRub = vi.fn()
  const repo = { getStatus, listCountedWithdrawals, getTotalDepositedRub }
  // Пороги читаются из конфига, а не из литерала — тот же источник, что у
  // GET /kyc (kyc-limits.ts), чтобы «UI обещает 10 000, сервер держит 5 000»
  // не вернулось.
  const config = {
    get: (key: string) => (key === 'KYC_WITHDRAW_LIMIT_RUB' ? WITHDRAW_LIMIT : undefined),
  }
  // Курс нужен только строкам без amount_rub; в этом стенке он умножает на 2,
  // чтобы «перевёл по курсу» было отличимо от «взял как есть». Боевой источник —
  // convertToRubAtLiveRate: тот же, что отдаёт цифру на GET /kyc.
  const geo = {
    convertToRubAtLiveRate: async (amount: string) => String(Number(amount) * 2),
  }
  const service = new KycCheckService(
    repo as unknown as IKycRepository,
    config as unknown as ConfigService,
    geo as unknown as GeoFacade,
  )
  return { service, getStatus, listCountedWithdrawals }
}

let getStatus: ReturnType<typeof makeService>['getStatus']
let listCountedWithdrawals: ReturnType<typeof makeService>['listCountedWithdrawals']
let service: KycCheckService

beforeEach(() => {
  const made = makeService()
  service = made.service
  getStatus = made.getStatus
  listCountedWithdrawals = made.listCountedWithdrawals
  getStatus.mockReset().mockResolvedValue(null)
  listCountedWithdrawals.mockReset().mockResolvedValue([])
})

describe('KycCheckService.assertCanWithdraw — верификация обязательна выше порога', () => {
  it('approved выводит любую сумму и не смотрит историю', async () => {
    // Arrange
    getStatus.mockResolvedValue(statusOf('approved'))
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID, '999999')).resolves.toBeUndefined()
    expect(listCountedWithdrawals).toHaveBeenCalledTimes(0)
  })

  it('ровно порог включительно: 5 000 ₽ без верификации проходит', async () => {
    // Arrange
    getStatus.mockResolvedValue(statusOf('pending'))
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID, WITHDRAW_LIMIT)).resolves.toBeUndefined()
  })

  it('5 000 ₽ 1 ₽ — отказ, тот же код, что и прежний полный запрет', async () => {
    // Arrange
    getStatus.mockResolvedValue(statusOf('pending'))
    // Act
    const attempt = service.assertCanWithdraw(USER_ID, '5000.01')
    // Assert
    await expect(attempt).rejects.toBeInstanceOf(KycRequiredError)
    await expect(attempt).rejects.toMatchObject({ code: 'KYC_REQUIRED', httpStatus: 422 })
  })

  it('профиль ещё не создан (null) — не отказ, а порог: 1 000 ₽ проходит', async () => {
    // Arrange — «нет профиля» и «профиль pending» для игрока одинаковы: он ещё
    // не верифицирован, но мелкие выводы ему не запрещены.
    getStatus.mockResolvedValue(null)
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID, '1000')).resolves.toBeUndefined()
  })

  it('база порога — оборот, а не заявка: 4 000 ₽ уже выведено, ещё 1 500 ₽ — отказ', async () => {
    // Arrange
    getStatus.mockResolvedValue(statusOf('not_submitted'))
    listCountedWithdrawals.mockResolvedValue([row('4000')])
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID, '1500')).rejects.toBeInstanceOf(
      KycRequiredError,
    )
    await expect(service.assertCanWithdraw(USER_ID, '1000')).resolves.toBeUndefined()
  })

  it('pending-заявка считается сразу: её деньги уже заморожены, а не «потом видно»', async () => {
    // Arrange — репозиторий возвращает pending/processing/completed (см.
    // kyc.prisma.ts); для сервиса это один список, и он обязан его учесть.
    listCountedWithdrawals.mockResolvedValue([row('3000'), row('2500')])
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID, '1')).rejects.toBeInstanceOf(KycRequiredError)
  })

  it('строка без amount_rub (выводы до 2026-10-07) переводится по курсу валюты', async () => {
    // Arrange — geo.toRubEquivalent в этом стенке умножает на 2, значит 100 USDT
    // это 200 ₽: 4 950 ₽ уже есть, +200 ₽ = 5 150 ₽ > 5 000 ₽.
    listCountedWithdrawals.mockResolvedValue([row('4950'), row(null, 'USDT_TRC20', '100')])
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID, '1')).rejects.toBeInstanceOf(KycRequiredError)
  })

  it('история считается заново на каждый интент, а не кэшируется между вызовами', async () => {
    // Arrange — два интента подряд: вторая заявка обязана увидеть первую,
    // иначе «одновременно два вывода по 5 000 ₽» прошли бы оба.
    getStatus.mockResolvedValue(statusOf('not_submitted'))
    // Act
    await service.assertCanWithdraw(USER_ID, '2000')
    await service.assertCanWithdraw(USER_ID, '2000')
    // Assert
    expect(listCountedWithdrawals).toHaveBeenCalledTimes(2)
  })

  it('отказ хранилища KYC не открывает вывод (fail-closed)', async () => {
    // Arrange — единственный guard вывода: падение порта не должно значить «пропустили»
    getStatus.mockRejectedValue(new Error('kyc store down'))
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID, '1')).rejects.toThrow('kyc store down')
  })

  it('отказ истории выводов не открывает вывод (fail-closed)', async () => {
    // Arrange — без базы порога мы не знаем, сколько уже отдано: безопасный
    // ответ — отказать, а не «считать нулём».
    getStatus.mockResolvedValue(statusOf('not_submitted'))
    listCountedWithdrawals.mockRejectedValue(new Error('payment_requests unavailable'))
    // Act/Assert
    await expect(service.assertCanWithdraw(USER_ID, '1')).rejects.toThrow(
      'payment_requests unavailable',
    )
  })

  it('порог читается из KYC_WITHDRAW_LIMIT_RUB, а не из литерала', async () => {
    // Arrange — 10 000 ₽ в конфиге меняет и отказ, и цифру на GET /kyc: один
    // источник на оба места.
    const config = { get: () => '10000' }
    const service10k = new KycCheckService(
      {
        getStatus: vi.fn().mockResolvedValue(statusOf('not_submitted')),
        listCountedWithdrawals: vi.fn().mockResolvedValue([]),
      } as unknown as IKycRepository,
      config as unknown as ConfigService,
      { toRubEquivalent: (amount: string) => amount } as unknown as GeoFacade,
    )
    // Act/Assert
    await expect(service10k.assertCanWithdraw(USER_ID, '9000')).resolves.toBeUndefined()
    await expect(service10k.assertCanWithdraw(USER_ID, '10001')).rejects.toBeInstanceOf(
      KycRequiredError,
    )
  })
})
