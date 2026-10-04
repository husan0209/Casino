/**
 * Юнит-тесты KycCheckService.
 *
 * Проверяются два разных контракта:
 * 1) assertCanDeposit — проверка ДО создания заявки (отказ возможен);
 * 2) escalateOverDepositLimit — фиксация ПОСЛЕ зачисления по вебхуку
 *    (отказ невозможен: деньги игрока уже на балансе, поэтому здесь только
 *    структурированный warn-лог).
 *
 * Порог читается из KYC_DEPOSIT_LIMIT_RUB через application/deposit-limit.ts
 * (общий с GET /kyc). В рантайме ConfigService отдаёт число (env-схема
 * coerцит значение), в тестах фикс возвращает и число, и строку — чтобы
 * расхождение «UI обещает 10 000, сервер держит 5 000» не вернулось.
 */
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'


import type { AppError } from '@casino/shared-utils'

import { KycCheckService } from './kyc-check.service'
import { DepositLimitExceededError, KycRequiredError } from '../../domain/errors'

import type { IKycRepository } from '../../domain/repositories/kyc.repository'
import type { ConfigService } from '@nestjs/config'
import type { MockInstance } from 'vitest'

type KycStatusRow = { status: string } | null

function makeRepo(
  status: KycStatusRow,
  totalDepositedRub: string,
  opts: { throws?: boolean | undefined } = {},
): IKycRepository {
  const repo = {
    getStatus: async () => {
      if (opts.throws) {
        throw new Error('kyc db down')
      }
      return status as never
    },
    getTotalDepositedRub: async () => totalDepositedRub,
  }
  return repo as unknown as IKycRepository
}

/** Фик ConfigService: порог таким, каким его отдаёт валидированный env. */
function makeConfig(value: string | number | undefined): ConfigService {
  return { get: () => value } as unknown as ConfigService
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
}): KycCheckService {
  return new KycCheckService(
    makeRepo(args.status ?? { status: 'not_started' }, args.total ?? '0', {
      throws: args.throws,
    }),
    makeConfig(args.limit),
  )
}

describe('KycCheckService.assertCanDeposit', () => {
  it('KYC approved — лимит не проверяется даже при огромной сумме', async () => {
    const service = makeService({ status: { status: 'approved' }, total: '999999' })
    await expect(service.assertCanDeposit('u-1', '500000')).resolves.toBeUndefined()
  })

  it('лимит не исчерпан (total + new <= threshold) — пропуск', async () => {
    const service = makeService({ total: '4000', limit: 5000 })
    await expect(service.assertCanDeposit('u-1', '1000')).resolves.toBeUndefined()
  })

  it('превышение — DepositLimitExceededError с кодом DEPOSIT_LIMIT_EXCEEDED и порогом в тексте', async () => {
    const service = makeService({ total: '4500', limit: 5000 })
    const error = await captureError(service.assertCanDeposit('u-1', '1000.01'))

    expect(error).toBeInstanceOf(DepositLimitExceededError)
    // совместимость: это всё ещё KycRequiredError (общая ветка «нужен KYC»)
    expect(error).toBeInstanceOf(KycRequiredError)
    expect(error.code).toBe('DEPOSIT_LIMIT_EXCEEDED')
    expect(error.httpStatus).toBe(422)
    expect(error.message).toContain('5000')
  })

  it('порог берётся из KYC_DEPOSIT_LIMIT_RUB, а не из литерала 5000', async () => {
    // Конфиг — число (z.coerce.number в env.validation.ts:92).
    const service = makeService({ total: '0', limit: 10000 })
    await expect(service.assertCanDeposit('u-1', '6000')).resolves.toBeUndefined()

    const overLimit = makeService({ total: '0', limit: 10000 })
    await expect(overLimit.assertCanDeposit('u-1', '10000.01')).rejects.toBeInstanceOf(
      DepositLimitExceededError,
    )
  })

  it('порог строкой приводит money-строку без потери значения', async () => {
    const service = makeService({ total: '0', limit: '10000' })
    await expect(service.assertCanDeposit('u-1', '9999.99')).resolves.toBeUndefined()
    await expect(service.assertCanDeposit('u-1', '10000.01')).rejects.toBeInstanceOf(
      DepositLimitExceededError,
    )
  })

  it('без настроенного порога — дефолт 5000 (как в GET /kyc)', async () => {
    const service = makeService({ total: '0', limit: undefined })
    await expect(service.assertCanDeposit('u-1', '5000')).resolves.toBeUndefined()
    await expect(service.assertCanDeposit('u-1', '5001')).rejects.toBeInstanceOf(
      DepositLimitExceededError,
    )
  })

  it('явный limitRub от callers перекрывает конфиг', async () => {
    const service = makeService({ total: '0', limit: 10000 })
    await expect(service.assertCanDeposit('u-1', '600', '500')).rejects.toBeInstanceOf(
      DepositLimitExceededError,
    )
  })

  it('total = null в БД считается нулём', async () => {
    const service = makeService({ total: '', limit: 5000 })
    await expect(service.assertCanDeposit('u-1', '5000')).resolves.toBeUndefined()
  })
})

describe('KycCheckService.assertCanWithdraw', () => {
  it('approved — пропуск', async () => {
    const service = makeService({ status: { status: 'approved' } })
    await expect(service.assertCanWithdraw('u-1')).resolves.toBeUndefined()
  })

  it('не approved — KycRequiredError (код KYC_REQUIRED, 422)', async () => {
    const service = makeService({ status: { status: 'pending' } })
    const error = await captureError(service.assertCanWithdraw('u-1'))
    expect(error).toBeInstanceOf(KycRequiredError)
    expect(error.code).toBe('KYC_REQUIRED')
    expect(error.httpStatus).toBe(422)
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
