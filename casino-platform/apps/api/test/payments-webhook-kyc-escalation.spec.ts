/**
 * Юнит-тесты эскалации KYC-лимита на путях зачисления по вебхуку (defect #2).
 *
 * Контракт денег: вебхук НЕ может отказать игроку, заплатившему реальные деньги,
 * поэтому превышение лимита без KYC фиксируется, а не откатывает зачисление.
 * Проверка на интенте (KycCheckService.assertCanDeposit) не покрывает: заявку,
 * созданную до правила/до понижения порога, гонку двух интентов и переплату
 * провайдера (NOWPayments `actually_paid`).
 *
 * Под Nest-di запускается РЕАЛЬНАЯ связка kyc-модуля: KycFacade → KycCheckService
 * поверх in-memory фейков IKycRepository и ConfigService. Так проверяется не
 * «фасад позвали», а факт структурированного warn-лога с порогом и суммой.
 * Дедуп по pr.status === 'completed' — почему повторная доставка не эскалирует
 * второй раз.
 */
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'


import { KycCheckService } from '../src/modules/kyc/application/use-cases/kyc-check.service'
import { KycFacade } from '../src/modules/kyc/facade/kyc.facade'
import { ProcessNOWPaymentsWebhookUseCase } from '../src/modules/payments/application/use-cases/process-nowpayments-webhook.use-case'
import { ProcessRukassaWebhookUseCase } from '../src/modules/payments/application/use-cases/process-rukassa-webhook.use-case'

import type { IKycRepository } from '../src/modules/kyc/domain/repositories/kyc.repository'
import type {
  INowPaymentsClient,
  IPaymentRequestRepository,
  IRukassaClient,
  PaymentRequest,
} from '../src/modules/payments/domain/payments.ports'
import type { MockInstance } from 'vitest'

/** Строка платёжки в памяти фейка: статус mutable, как в БД после updateStatus. */
type FakeRow = {
  id: string
  userId: string
  externalId: string
  type: string
  status: string
  currency: string
  method: string | null
  amount: { toString(): string }
}

type CreditCall = { userId: string; currency: string; amount: string; idempotencyKey: string }
type CallbackResult = { id: string; result: string | undefined }

function makePaymentRepo(rows: FakeRow[]) {
  const callbackResults: CallbackResult[] = []
  let savedCallbacks = 0
  const repo = {
    saveCallback: async () => {
      savedCallbacks += 1
      return { id: `cb-${savedCallbacks}` } as never
    },
    markCallbackProcessed: async (id: string, result?: string) => {
      callbackResults.push({ id, result })
      return {} as never
    },
    findByExternalId: async (externalId: string) =>
      rows.find((row) => row.externalId === externalId) ?? null,
    findById: async (id: string) => rows.find((row) => row.id === id) ?? null,
    updateStatus: async (id: string, status: string) => {
      const row = rows.find((candidate) => candidate.id === id)
      if (row) {
        row.status = status
      }
      return (row ?? {}) as unknown as PaymentRequest
    },
  } as unknown as IPaymentRequestRepository
  return { repo, callbackResults }
}

/**
 * Фейк KYC-репозитория: `lifetimeRub` — сумма completed-депозитов игрока, то,
 * что в проде считает PrismaKycRepository.getTotalDepositedRub.
 */
function makeKycRepo(args: { status: string; lifetimeRub: string; throws?: boolean | undefined }) {
  return {
    getStatus: async () => {
      if (args.throws) {
        throw new Error('kyc db down')
      }
      return { status: args.status, submittedAt: null, rejectionReason: null, documents: [] }
    },
    getTotalDepositedRub: async () => args.lifetimeRub,
  } as unknown as IKycRepository
}

/** Реальный фасад kyc поверх фейков: лог эскалации должен дойти до Logger. */
function makeRealKycFacade(args: {
  status: string
  lifetimeRub: string
  limit: string | number | undefined
  throws?: boolean | undefined
}) {
  return new KycFacade(
    new KycCheckService(
      makeKycRepo({ status: args.status, lifetimeRub: args.lifetimeRub, throws: args.throws }),
      { get: () => args.limit } as never,
    ),
  )
}

function makeDeps(args: {
  rows: FakeRow[]
  kycStatus?: string
  lifetimeRub?: string
  limitRub?: string | number
  kycThrows?: boolean
}) {
  const payment = makePaymentRepo(args.rows)
  const credited: CreditCall[] = []
  const wallet = {
    credit: async (input: CreditCall) => {
      credited.push(input)
      return { ok: true }
    },
  } as never
  const users = { onDepositCompleted: async () => undefined } as never
  const kyc = makeRealKycFacade({
    status: args.kycStatus ?? 'not_started',
    lifetimeRub: args.lifetimeRub ?? '0',
    limit: args.limitRub,
    throws: args.kycThrows,
  })

  return {
    payment,
    credited,
    rukassaUc: new ProcessRukassaWebhookUseCase(
      payment.repo,
      { verifyCallback: () => true } as unknown as IRukassaClient,
      wallet,
      users,
      kyc,
    ),
    nowpaymentsUc: new ProcessNOWPaymentsWebhookUseCase(
      payment.repo,
      { verifyIPN: () => true } as unknown as INowPaymentsClient,
      wallet,
      users,
      kyc,
    ),
  }
}

function depositRow(over: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'pr-1',
    userId: 'u-1',
    externalId: 'ord-100',
    type: 'deposit',
    status: 'pending',
    currency: 'RUB',
    method: 'card',
    amount: { toString: () => '3000' },
    ...over,
  }
}

function rukassaInput(body: Record<string, unknown>) {
  return {
    rawHeaders: { 'x-signature': 'ok' },
    body,
    rawBody: JSON.stringify(body),
    ip: '1.2.3.4',
  }
}

function nowpaymentsInput(body: Record<string, unknown>) {
  return {
    rawHeaders: { 'x-nowpayments-sig': 'sig' },
    body,
    rawBody: JSON.stringify(body),
    ip: '1.2.3.4',
  }
}

let warn: MockInstance
let error: MockInstance

beforeEach(() => {
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Структурированные warn-записи, накопленные эскалацией за прогон теста. */
function escalationLogs(): Array<Record<string, unknown>> {
  return warn.mock.calls.map((call) => call[0] as Record<string, unknown>)
}

describe('webhook эскалация KYC-лимита: Rukassa', () => {
  it('лимит превышен: деньги зачислены, заявка completed, эскалация зафиксирована', async () => {
    const rows = [depositRow()]
    const d = makeDeps({ rows, lifetimeRub: '8000', limitRub: 5000 })

    const res = await d.rukassaUc.execute(rukassaInput({ order_id: 'ord-100', status: 'success' }))

    expect(res).toEqual({ ok: true })
    expect(d.credited).toHaveLength(1)
    expect(d.credited[0]!.idempotencyKey).toBe('deposit_rukassa_ord-100')
    expect(d.credited[0]!.amount).toBe('3000')
    expect(rows[0]!.status).toBe('completed')
    expect(d.payment.callbackResults).toEqual([{ id: 'cb-1', result: 'ok' }])

    expect(escalationLogs()).toEqual([
      {
        msg: 'KYC deposit limit exceeded by credited deposit',
        event: 'kyc_deposit_limit_exceeded',
        user_id: 'u-1',
        payment_request_id: 'pr-1',
        threshold_rub: '5000',
        total_deposited_rub: '8000',
      },
    ])
  })

  it('повторная доставка того же коллбэка: ни второго зачисления, ни второй эскалации', async () => {
    const rows = [depositRow()]
    const d = makeDeps({ rows, lifetimeRub: '8000', limitRub: 5000 })
    const body = { order_id: 'ord-100', status: 'success' }

    await d.rukassaUc.execute(rukassaInput(body))
    await d.rukassaUc.execute(rukassaInput(body))

    expect(d.credited).toHaveLength(1)
    expect(escalationLogs()).toHaveLength(1)
    expect(d.payment.callbackResults).toEqual([
      { id: 'cb-1', result: 'ok' },
      { id: 'cb-2', result: 'duplicate' },
    ])
  })

  it('порог из KYC_DEPOSIT_LIMIT_RUB, а не литерал 5000: 8000 при лимите 10000 не эскалируется', async () => {
    const rows = [depositRow()]
    const d = makeDeps({ rows, lifetimeRub: '8000', limitRub: 10000 })

    await d.rukassaUc.execute(rukassaInput({ order_id: 'ord-100', status: 'success' }))

    expect(d.credited).toHaveLength(1)
    expect(escalationLogs()).toHaveLength(0)
  })

  it('число и строка в конфиге дают один и тот же порог', async () => {
    const asNumber = [depositRow({ id: 'pr-1', externalId: 'ord-1' })]
    await makeDeps({ rows: asNumber, lifetimeRub: '8000', limitRub: 10000 })
      .rukassaUc.execute(rukassaInput({ order_id: 'ord-1', status: 'success' }))
    expect(escalationLogs()).toHaveLength(0)

    const asString = [depositRow({ id: 'pr-2', externalId: 'ord-2' })]
    await makeDeps({ rows: asString, lifetimeRub: '8000', limitRub: '10000' })
      .rukassaUc.execute(rukassaInput({ order_id: 'ord-2', status: 'success' }))
    expect(escalationLogs()).toHaveLength(0)

    const below = [depositRow({ id: 'pr-3', externalId: 'ord-3' })]
    await makeDeps({ rows: below, lifetimeRub: '8000', limitRub: '5000' })
      .rukassaUc.execute(rukassaInput({ order_id: 'ord-3', status: 'success' }))
    expect(escalationLogs()[0]!.threshold_rub).toBe('5000')
  })

  it('KYC approved — зачисление есть, эскалации нет', async () => {
    const rows = [depositRow()]
    const d = makeDeps({ rows, kycStatus: 'approved', lifetimeRub: '8000', limitRub: 5000 })

    await d.rukassaUc.execute(rukassaInput({ order_id: 'ord-100', status: 'success' }))

    expect(d.credited).toHaveLength(1)
    expect(escalationLogs()).toHaveLength(0)
  })

  it('внутри лимита — эскалации нет', async () => {
    const rows = [depositRow()]
    const d = makeDeps({ rows, lifetimeRub: '3000', limitRub: 5000 })

    await d.rukassaUc.execute(rukassaInput({ order_id: 'ord-100', status: 'success' }))

    expect(d.credited).toHaveLength(1)
    expect(escalationLogs()).toHaveLength(0)
  })

  it('провал платежа провайдером — ни зачисления, ни эскалации', async () => {
    const rows = [depositRow()]
    const d = makeDeps({ rows, lifetimeRub: '8000', limitRub: 5000 })

    await d.rukassaUc.execute(rukassaInput({ order_id: 'ord-100', status: 'rejected' }))

    expect(d.credited).toHaveLength(0)
    expect(escalationLogs()).toHaveLength(0)
    expect(rows[0]!.status).toBe('failed')
  })

  it('сбой KYC-обвязки не ломает вебхук и не помечает коллбэк ошибкой', async () => {
    const rows = [depositRow()]
    const d = makeDeps({ rows, lifetimeRub: '8000', limitRub: 5000, kycThrows: true })

    const res = await d.rukassaUc.execute(rukassaInput({ order_id: 'ord-100', status: 'success' }))

    expect(res).toEqual({ ok: true })
    expect(d.credited).toHaveLength(1)
    expect(rows[0]!.status).toBe('completed')
    expect(d.payment.callbackResults).toEqual([{ id: 'cb-1', result: 'ok' }])
    expect(escalationLogs()).toHaveLength(0)
    // сбой фиксации — только error-лог, наружу не бросаем (webhook §8.3)
    expect(error.mock.calls).toHaveLength(1)
    expect(String(error.mock.calls[0]![0])).toContain('kyc db down')
  })
})

describe('webhook эскалация KYC-лимита: NOWPayments', () => {
  it('finished: actually_paid зачислен, эскалация зафиксирована', async () => {
    const rows = [
      depositRow({ externalId: 'np-1', currency: 'USDT_TRC20', amount: { toString: () => '100' } }),
    ]
    const d = makeDeps({ rows, lifetimeRub: '12000', limitRub: 5000 })

    const res = await d.nowpaymentsUc.execute(
      nowpaymentsInput({ payment_id: 'np-1', payment_status: 'finished', actually_paid: '110' }),
    )

    expect(res).toEqual({ ok: true })
    expect(d.credited).toHaveLength(1)
    expect(d.credited[0]!.amount).toBe('110')
    expect(d.credited[0]!.idempotencyKey).toBe('deposit_nowpayments_np-1')
    expect(rows[0]!.status).toBe('completed')

    expect(escalationLogs()).toEqual([
      {
        msg: 'KYC deposit limit exceeded by credited deposit',
        event: 'kyc_deposit_limit_exceeded',
        user_id: 'u-1',
        payment_request_id: 'pr-1',
        threshold_rub: '5000',
        total_deposited_rub: '12000',
      },
    ])
  })

  it('повторный IPN по тому же payment_id: duplicate, эскалация не повторяется', async () => {
    const rows = [depositRow({ externalId: 'np-1' })]
    const d = makeDeps({ rows, lifetimeRub: '12000', limitRub: 5000 })
    const body = { payment_id: 'np-1', payment_status: 'finished', actually_paid: '110' }

    await d.nowpaymentsUc.execute(nowpaymentsInput(body))
    await d.nowpaymentsUc.execute(nowpaymentsInput(body))

    expect(d.credited).toHaveLength(1)
    expect(escalationLogs()).toHaveLength(1)
    expect(d.payment.callbackResults).toEqual([
      { id: 'cb-1', result: 'ok' },
      { id: 'cb-2', result: 'duplicate' },
    ])
  })

  it('порог из конфига: при KYC_DEPOSIT_LIMIT_RUB=10000 сумма 9000 не эскалируется', async () => {
    const rows = [depositRow({ externalId: 'np-1' })]
    const d = makeDeps({ rows, lifetimeRub: '9000', limitRub: 10000 })

    await d.nowpaymentsUc.execute(
      nowpaymentsInput({ payment_id: 'np-1', payment_status: 'confirmed' }),
    )

    expect(d.credited).toHaveLength(1)
    expect(escalationLogs()).toHaveLength(0)
  })

  it('промежуточный статус (waiting) — ни зачисления, ни эскалации', async () => {
    const rows = [depositRow({ externalId: 'np-1' })]
    const d = makeDeps({ rows, lifetimeRub: '12000', limitRub: 5000 })

    await d.nowpaymentsUc.execute(
      nowpaymentsInput({ payment_id: 'np-1', payment_status: 'waiting' }),
    )

    expect(d.credited).toHaveLength(0)
    expect(escalationLogs()).toHaveLength(0)
  })

  it('сбой зачисления — эскалации нет (деньги не зачислены, превышения нет)', async () => {
    const rows = [depositRow({ externalId: 'np-1' })]
    const payment = makePaymentRepo(rows)
    const uc = new ProcessNOWPaymentsWebhookUseCase(
      payment.repo,
      { verifyIPN: () => true } as unknown as INowPaymentsClient,
      {
        credit: async () => {
          throw new Error('ledger down')
        },
      } as never,
      { onDepositCompleted: async () => undefined } as never,
      makeRealKycFacade({ status: 'not_started', lifetimeRub: '12000', limit: 5000 }),
    )

    const res = await uc.execute(nowpaymentsInput({ payment_id: 'np-1', payment_status: 'finished' }))

    expect(res).toEqual({ ok: true })
    expect(escalationLogs()).toHaveLength(0)
    expect(rows[0]!.status).toBe('pending')
    expect(payment.callbackResults[0]!.result).toContain('ledger down')
  })
})
