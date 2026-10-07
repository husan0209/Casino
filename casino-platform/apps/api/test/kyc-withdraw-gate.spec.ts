/**
 * Юнит-тесты KycCheckService — гейта верификации на ВЫВОДЕ (слепая зона G21).
 *
 * Гард G21 следит только за `*.use-case.ts`, поэтому `application/*.service.ts`
 * остаются вне его радара. Здесь закрыты ветки, где ошибка стоит денег, а не
 * удобства:
 *  - вывод разрешён только approved;
 *  - отказ хранилища KYC НЕ открывает вывод (fail-closed): assertCanWithdraw —
 *    единственный guard вывода, поэтому «тихий пропуск» при упавшем репозитории
 *    означал бы выпуск средств неверифицированному игроку.
 *
 * Что здесь раньше лежало и удалено 2026-10-07: `assertCanDeposit` — шлюз
 * «суммарные пополнения до KYC_DEPOSIT_LIMIT_RUB». Верификация нужна на выводе,
 * а не на пополнении (решение владельца), поэтому у сервиса больше нет метода для
 * депозита. Что пополнение не ходит в KYC — закреплено в спеках
 * `payments-create-fiat-deposit.spec.ts` и `payments-create-crypto-deposit.spec.ts`.
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

/** Порт KYC in-memory: сервис использует getStatus и сумму депозитов (риск-лог). */
function makeService() {
  const getStatus = vi.fn()
  const getTotalDepositedRub = vi.fn()
  const repo = { getStatus, getTotalDepositedRub }
  // GAP-72: порог читается из конфига, а не из литерала, — тот же источник, что
  // у GET /kyc, чтобы «UI обещает 10 000, сервер держит 5 000» не вернулось.
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
