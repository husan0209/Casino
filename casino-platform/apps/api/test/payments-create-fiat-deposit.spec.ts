/**
 * Юнит-тесты CreateFiatDepositUseCase (G21).
 *
 * Пайплайн: geo-валидация метода → лимиты (money.*, string) → заявка в БД →
 * Rukassa createPayment → updateStatus(pending). Верификации в депозите нет
 * (2026-10-07): KYC обязателен на выводе. Падение
 * провайдера: заявка помечается failed, наружу PaymentProviderError.
 * Фасады geo/users подменены узкими объектами (`as unknown as`).
 */
import {
  CreateFiatDepositUseCase,
  FIAT_UNPAID_ATTEMPTS_PER_DAY,
  rukassaOrderId,
  startOfMoscowDay,
} from '../src/modules/payments/application/use-cases/create-fiat-deposit.use-case'
import {
  AmountTooSmallError,
  FiatDepositAttemptLimitError,
  PaymentProviderError,
} from '../src/modules/payments/domain/errors'

import type {
  IPaymentRequestRepository,
  IRukassaClient,
  PaymentRequest,
  RukassaCreatePayment,
} from '../src/modules/payments/domain/payments.ports'

const INPUT = { amount: '1000', currency: 'RUB', method: 'card' }

type CreatedRow = Record<string, unknown>
type StatusUpdate = { id: string; status: string; extra: Record<string, unknown> | undefined }

function makeDeps(over: { rukassaError?: Error; unfinished?: number } = {}) {
  const created: CreatedRow[] = []
  const statusUpdates: StatusUpdate[] = []
  const geoCalls: Array<{ fn: string; args: unknown[] }> = []
  const countCalls: Array<Record<string, unknown>> = []

  const repo = {
    create: async (data: CreatedRow) => {
      created.push(data)
      return { id: 'pr-1' } as unknown as PaymentRequest
    },
    countUnfinishedDeposits: async (args: Record<string, unknown>) => {
      countCalls.push(args)
      return over.unfinished ?? 0
    },
    updateStatus: async (id: string, status: string, extra?: Record<string, unknown>) => {
      statusUpdates.push({ id, status, extra })
      return { id } as unknown as PaymentRequest
    },
  } as unknown as IPaymentRequestRepository

  const rukassaCalls: Array<Record<string, unknown>> = []
  const rukassa: IRukassaClient = {
    createPayment: async (params: RukassaCreatePayment) => {
      if (over.rukassaError) {
        throw over.rukassaError
      }
      rukassaCalls.push(params as unknown as Record<string, unknown>)
      return { paymentId: '4242', paymentUrl: 'https://pay.url' }
    },
  } as unknown as IRukassaClient

  const geo = {
    resolveLegalCountry: (country: string | null) => {
      geoCalls.push({ fn: 'resolveLegalCountry', args: [country] })
      return 'RU'
    },
    validateFiatDepositMethod: (...args: unknown[]) => {
      geoCalls.push({ fn: 'validateFiatDepositMethod', args })
    },
    getLimits: () => ({ depositMin: '500' }),
    toRubEquivalent: (amount: string) => `rub(${amount})`,
  } as never

  const users = { getGeoContext: async () => ({ country: 'RU' }) } as never

  const uc = new CreateFiatDepositUseCase(repo, rukassa, geo, users)
  return { uc, created, statusUpdates, geoCalls, rukassaCalls, countCalls }
}

describe('CreateFiatDepositUseCase', () => {
  it('happy path: заявка pending, Rukassa вызван, статус дополнен ссылками', async () => {
    const d = makeDeps()
    const before = Date.now()
    const res = await d.uc.execute('u-1', INPUT)

    expect(d.geoCalls).toEqual([
      { fn: 'resolveLegalCountry', args: ['RU'] },
      { fn: 'validateFiatDepositMethod', args: ['RU', 'RUB', 'card'] },
    ])
    const row = d.created[0]!
    expect(row.userId).toBe('u-1')
    expect(row.type).toBe('deposit')
    expect(row.status).toBe('pending')
    expect(row.provider).toBe('rukassa')
    expect(row.amount).toBe('1000')
    expect(row.idempotencyKey).toMatch(/^dep_/)
    const hours = ((row.expiresAt as Date).getTime() - before) / 3_600_000
    expect(hours).toBeGreaterThan(1.9)
    expect(hours).toBeLessThan(2.1)

    expect(d.statusUpdates).toEqual([
      {
        id: 'pr-1',
        status: 'pending',
        extra: { externalId: '4242', paymentUrl: 'https://pay.url' },
      },
    ])
    expect(res).toEqual({
      payment_request_id: 'pr-1',
      payment_url: 'https://pay.url',
      currency: 'RUB',
      method: 'card',
    })

    // Контракт Rukassa: order_id числом + сквозной data, по которому вебхук
    // находит нашу заявку (их уведомление не содержит наш UUID).
    expect(d.rukassaCalls).toHaveLength(1)
    const call = d.rukassaCalls[0]!
    expect(call.amount).toBe('1000')
    expect(call.currency).toBe('RUB')
    expect(call.method).toBe('card')
    expect(String(call.orderId)).toMatch(/^\d{13,18}$/)
    expect(call.data).toBe('{"payment_request_id":"pr-1"}')
    // `user_code` — их ключ КЛИЕНТА. Общий на всех (кодом магазина) RuKassa
    // замораживает суточным лимитом «client is frozen», поэтому — id игрока.
    expect(call.userCode).toBe('u-1')
  })

  it('order_id числовой и не повторяется в пределах одного запуска', async () => {
    const first = rukassaOrderId(1_750_000_000_000)
    const second = rukassaOrderId(1_750_000_000_000)
    const nextMs = rukassaOrderId(1_750_000_000_001)

    expect(first).toMatch(/^\d+$/)
    expect(second).not.toBe(first)
    expect(nextMs.startsWith('1750000000001')).toBe(true)
  })

  it('сумма ниже depositMin → AmountTooSmallError, заявка не создаётся', async () => {
    const d = makeDeps()
    await expect(d.uc.execute('u-1', { ...INPUT, amount: '499' })).rejects.toThrow(
      AmountTooSmallError,
    )
    expect(d.created).toHaveLength(0)
  })

  // Прежний `depositMax` 100 000 ₽ давал на этой сумме AMOUNT_TOO_LARGE. Верхней
  // границы у пополнения больше нет (решение владельца 2026-10-07) — предельный
  // контроль стоит только на выдаче (withdrawMax, withdrawal-currency-limits).
  it('сумма выше прежнего depositMax проходит: верхнего лимита на пополнении нет', async () => {
    const d = makeDeps()
    const res = await d.uc.execute('u-1', { ...INPUT, amount: '1000000.00' })

    expect(res.payment_request_id).toBe('pr-1')
    expect(d.created).toHaveLength(1)
    expect(d.created[0]!.amount).toBe('1000000.00')
  })

  // Прежний шлюз «суммарные пополнения до KYC_DEPOSIT_LIMIT_RUB» снят
  // 2026-10-07: верификация обязательна на выводе, а не на пополнении (решение
  // владельца). Тест фиксирует новую политику на сумме, которая раньше упиралась
  // в порог 5000 ₽: заявка создаётся, ни в какой KYC use-case не ходит.
  it('пополнение выше прежнего KYC-порога проходит без верификации', async () => {
    const d = makeDeps()
    const res = await d.uc.execute('u-1', { ...INPUT, amount: '6000' })

    expect(res.payment_request_id).toBe('pr-1')
    expect(d.created).toHaveLength(1)
    expect(d.created[0]!.amount).toBe('6000')
  })

  it('Rukassa упал → заявка failed с errorMessage, наружу PaymentProviderError', async () => {
    const d = makeDeps({ rukassaError: new Error('psp down') })
    await expect(d.uc.execute('u-1', INPUT)).rejects.toThrow(PaymentProviderError)
    expect(d.statusUpdates).toEqual([
      { id: 'pr-1', status: 'failed', extra: { errorMessage: 'psp down' } },
    ])
  })

  /**
   * Код обязан различать причины: на «счёт приостановлен» повторный клик только
   * закапывает игрока (RuKassa морозит клиента по `user_code` навсегда), на
   * «такого способа нет» достаточно выбрать другой. Оба отказа у провайдера
   * идут под одним `error: 300`, поэтому различаем по сообщению.
   */
  it('код отказа следует за текстом провайдера', async () => {
    const cases: Array<[string, string]> = [
      ['HTTP 403: {"error":"300","message":"client is frozen"}', 'PAYMENT_PROVIDER_ACCOUNT_FROZEN'],
      [
        'HTTP 403: {"error":"300","message":"method is not activated"}',
        'PAYMENT_PROVIDER_METHOD_UNAVAILABLE',
      ],
      ['HTTP 403: {"error":"300","message":"shop not found"}', 'PAYMENT_PROVIDER_ERROR'],
    ]
    for (const [reason, code] of cases) {
      const d = makeDeps({ rukassaError: new Error(reason) })
      await expect(d.uc.execute('u-1', INPUT)).rejects.toMatchObject({ code })
    }
  })

  /**
   * Суточный самолимит. Смысл не в «не спамить кнопкой», а в том, что каждая
   * неоплаченная заявка стоит игрока у RuKassa: порог измерен на стенде 16.10
   * (три неоплаченных счёта проходят, на четвёртом — `client is frozen`), а
   * разморозки через API нет ни у нас, ни у мерчанта.
   */
  it('двух неоплаченных заявок за сутки достаточно: наружу 422, до RuKassa не дошло', async () => {
    const d = makeDeps({ unfinished: FIAT_UNPAID_ATTEMPTS_PER_DAY })

    await expect(d.uc.execute('u-1', INPUT)).rejects.toThrow(FiatDepositAttemptLimitError)
    expect(d.created).toHaveLength(0)
    expect(d.rukassaCalls).toHaveLength(0)
  })

  it('окно самолимита — текущие сутки по МСК, считаем только фиатные пополнения', async () => {
    const d = makeDeps({ unfinished: 1 })
    await d.uc.execute('u-1', INPUT)

    expect(d.countCalls).toHaveLength(1)
    const args = d.countCalls[0]!
    expect(args.userId).toBe('u-1')
    expect(args.provider).toBe('rukassa')
    const since = args.since as Date
    expect(since.getTime()).toBeLessThanOrEqual(Date.now())
    // полночь по МСК = 21:00 UTC ⇒ (since + 3 ч) кратно суткам
    expect((since.getTime() + 3 * 3_600_000) % 86_400_000).toBe(0)
  })

  describe('startOfMoscowDay', () => {
    const boundaries: Array<[string, string]> = [
      ['2026-10-16T00:10:00.000Z', '2026-10-15T21:00:00.000Z'],
      ['2026-10-16T20:00:00.000Z', '2026-10-15T21:00:00.000Z'],
      ['2026-10-16T21:30:00.000Z', '2026-10-16T21:00:00.000Z'],
    ]
    for (const [now, expected] of boundaries) {
      it(`${now} → ${expected}`, () => {
        expect(startOfMoscowDay(new Date(now)).toISOString()).toBe(expected)
      })
    }
  })
})
