/**
 * Юнит-тесты KycCheckService.
 *
 * Проверяются два разных контракта:
 * 1) assertCanWithdraw — верификация обязательна на ВЫВОДЕ выше порога
 *    (отказ возможен, и это единственный guard вывода);
 * 2) escalateOverDepositLimit — фиксация ПОСЛЕ зачисления по вебхуку
 *    (отказ невозможен: деньги игрока уже на балансе, поэтому здесь только
 *    структурированный warn-лог).
 *
 * Отдельно зафиксировано, чего здесь больше нет: `assertCanDeposit` (шлюз
 * «суммарные пополнения до KYC_DEPOSIT_LIMIT_RUB») удалён 2026-10-07 по решению
 * владельца — пополнение не требует верификации. Что порог после этого значит,
 * видно в тестах escalate-блока ниже: он пишет риск-лог и никому не отказывает.
 *
 * Оба порога читаются через application/kyc-limits.ts (общий с GET /kyc):
 * KYC_WITHDRAW_LIMIT_RUB — по нему вывод разрешён без верификации (решение
 * владельца 2026-10-07: «до 5 000 ₽ можно, 5 000 ₽ 1 ₽ — нужен KYC»),
 * KYC_DEPOSIT_LIMIT_RUB — только риск-лог. В рантайме ConfigService отдаёт
 * число (env-схема коэрцит значение), в тестах фикс возвращает и число, и
 * строку — чтобы расхождение «UI обещает 10 000, сервер держит 5 000» не
 * вернулось.
 */
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GeoFacade } from '@modules/geo/facade/geo.facade'

import type { AppError } from '@casino/shared-utils'

import { KycCheckService } from './kyc-check.service'
import { KycRequiredError } from '../../domain/errors'

import type { CountedWithdrawal, IKycRepository } from '../../domain/repositories/kyc.repository'
import type { ConfigService } from '@nestjs/config'
import type { MockInstance } from 'vitest'

type KycStatusRow = { status: string } | null

function makeRepo(
  status: KycStatusRow,
  totalDepositedRub: string,
  opts: { throws?: boolean | undefined; withdrawals?: CountedWithdrawal[] | undefined } = {},
): IKycRepository {
  const repo = {
    getStatus: async () => {
      if (opts.throws) {
        throw new Error('kyc db down')
      }
      return status as never
    },
    getTotalDepositedRub: async () => totalDepositedRub,
    listCountedWithdrawals: async () => {
      if (opts.throws) {
        throw new Error('kyc db down')
      }
      return opts.withdrawals ?? []
    },
  }
  return repo as unknown as IKycRepository
}

/** Фик ConfigService: порог таким, каким его отдаёт валидированный env. */
function makeConfig(value: string | number | undefined): ConfigService {
  return { get: () => value } as unknown as ConfigService
}

/**
 * Фикс курса: RUB — без пересчёта, остальные — удвоение. Удвоение выбрано
 * специально: «перевёл по курсу» отличается от «взял amount как рубли», и
 * подмена курса не может пройти тесты незамеченной.
 */
function makeGeo(): GeoFacade {
  return {
    convertToRubAtLiveRate: (amount: string, currency: string) =>
      currency === 'RUB' ? amount : String(Number(amount) * 2),
  } as unknown as GeoFacade
}

/** Поймать ожидаемое исключение как типизированный AppError. */
async function captureError(promise: Promise<unknown>): Promise<AppError> {
  return promise.then(
    () => {
      throw new Error('ожидалось исключение, но его не было')
    },
    (e: unknown) => e as AppError,
  )
}

function makeService(args: {
  status?: KycStatusRow
  total?: string
  limit?: string | number | undefined
  throws?: boolean
  withdrawals?: CountedWithdrawal[]
}): KycCheckService {
  return new KycCheckService(
    makeRepo(args.status ?? { status: 'not_started' }, args.total ?? '0', {
      throws: args.throws,
      withdrawals: args.withdrawals,
    }),
    makeConfig(args.limit),
    makeGeo(),
  )
}

const rowRub = (rub: string): CountedWithdrawal => ({
  currency: 'RUB',
  amount: rub,
  amountRub: rub,
})

describe('KycCheckService.assertCanWithdraw', () => {
  it('approved — пропуск, порог его не касается', async () => {
    const service = makeService({ status: { status: 'approved' } })
    await expect(service.assertCanWithdraw('u-1', '999999')).resolves.toBeUndefined()
  })

  it('ровно порог включительно — пропуск', async () => {
    const service = makeService({ status: { status: 'pending' }, limit: '5000' })
    await expect(service.assertCanWithdraw('u-1', '5000')).resolves.toBeUndefined()
  })

  it('выше порога — KycRequiredError (код KYC_REQUIRED, 422)', async () => {
    const service = makeService({ status: { status: 'pending' }, limit: '5000' })
    const error = await captureError(service.assertCanWithdraw('u-1', '5000.01'))
    expect(error).toBeInstanceOf(KycRequiredError)
    expect(error.code).toBe('KYC_REQUIRED')
    expect(error.httpStatus).toBe(422)
  })

  it('порог считается по обороту, а не по заявке: 4 000 ₽ уже выведено + 1 500 ₽', async () => {
    const service = makeService({
      limit: '5000',
      withdrawals: [rowRub('4000')],
    })
    const error = await captureError(service.assertCanWithdraw('u-1', '1500'))
    expect(error).toBeInstanceOf(KycRequiredError)
  })

  it('строка без amount_rub переводится по курсу валюты, а не берётся как ₽', async () => {
    // Выводы до 2026-10-07: колонку RUB заполнял только депозитный путь. Фикс
    // курса удваивает, значит 100 USDT — это 200 ₽: 4 950 ₽ + 200 ₽ > 5 000 ₽.
    const service = makeService({
      limit: '5000',
      withdrawals: [rowRub('4950'), { currency: 'USDT_TRC20', amount: '100', amountRub: null }],
    })
    const error = await captureError(service.assertCanWithdraw('u-1', '1'))
    expect(error).toBeInstanceOf(KycRequiredError)
  })

  it('падение истории выводов не открывает вывод (fail-closed)', async () => {
    const service = makeService({ throws: true, limit: '5000' })
    const error = await captureError(service.assertCanWithdraw('u-1', '1'))
    expect(error.message).toBe('kyc db down')
  })
})

describe('KycCheckService.escalateOverDepositLimit', () => {
  let warn: MockInstance
  let error: MockInstance

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function escalationPayload(): Record<string, unknown> {
    expect(warn).toHaveBeenCalledTimes(1)
    return warn.mock.calls[0]![0] as Record<string, unknown>
  }

  it('прошедший лимит депозит: warn со структурированным payload, значения — строки', async () => {
    const service = makeService({ total: '7000', limit: 5000 })
    await service.escalateOverDepositLimit({ userId: 'u-1', paymentRequestId: 'pr-1' })

    expect(escalationPayload()).toEqual({
      msg: 'KYC deposit limit exceeded by credited deposit',
      event: 'kyc_deposit_limit_exceeded',
      user_id: 'u-1',
      payment_request_id: 'pr-1',
      threshold_rub: '5000',
      total_deposited_rub: '7000',
    })
  })

  it('KYC approved — эскалации нет', async () => {
    const service = makeService({ status: { status: 'approved' }, total: '7000', limit: 5000 })
    await service.escalateOverDepositLimit({ userId: 'u-1', paymentRequestId: 'pr-1' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('внутри лимита — эскалации нет (превышение строго больше порога)', async () => {
    const atLimit = makeService({ total: '5000', limit: 5000 })
    await atLimit.escalateOverDepositLimit({ userId: 'u-1', paymentRequestId: 'pr-1' })
    expect(warn).not.toHaveBeenCalled()

    const under = makeService({ total: '100', limit: 5000 })
    await under.escalateOverDepositLimit({ userId: 'u-1', paymentRequestId: 'pr-1' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('порог для эскалации тоже из конфига, а не литерал 5000', async () => {
    const service = makeService({ total: '7000', limit: 10000 })
    await service.escalateOverDepositLimit({ userId: 'u-1', paymentRequestId: 'pr-1' })
    expect(warn).not.toHaveBeenCalled()

    const over = makeService({ total: '10000.01', limit: '10000' })
    await over.escalateOverDepositLimit({ userId: 'u-2', paymentRequestId: 'pr-2' })
    expect(escalationPayload().threshold_rub).toBe('10000')
    expect(escalationPayload().total_deposited_rub).toBe('10000.01')
  })

  it('сбой репозитория НЕ всплывает наружу: зачисление уже состоялось', async () => {
    const service = makeService({ total: '7000', limit: 5000, throws: true })
    await expect(
      service.escalateOverDepositLimit({ userId: 'u-1', paymentRequestId: 'pr-1' }),
    ).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
    expect(error.mock.calls[0]![0]).toContain('kyc db down')
  })
})
