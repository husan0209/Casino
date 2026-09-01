/**
 * GAP-28 (P3, defense-in-depth): идемпотентность депозитов по external_id провайдера.
 *
 * Ключ проводки был `deposit_${pr.id}` — уникальность OUR платёжки. Повторный
 * коллбэк по тому же внешнему платежу, смэпившийся на ДРУГУЮ платёжку (рассинхрон
 * маппинга, повторное создание PR), зачислил бы второй раз. Теперь ключ
 * `deposit_${provider}_${externalId}` — уникальный индекс ledger.idempotencyKey
 * отсекает повторное зачисление на уровне БД независимо от маппинга.
 *
 * Use-cases запускаются с in-memory фейками (без Nest DI и Postgres):
 * asserted контракт — КЛЮЧ зависит от external_id, а не от id платёжки.
 */
import { ProcessNOWPaymentsWebhookUseCase } from '../src/modules/payments/application/use-cases/process-nowpayments-webhook.use-case'
import { ProcessRukassaWebhookUseCase } from '../src/modules/payments/application/use-cases/process-rukassa-webhook.use-case'

type CreditCall = { idempotencyKey: string; amount: string; userId: string }

/** Фейк репозитория платёжек: один внешний платёж может смэпиться на разные pr. */
function fakeRepo(prs: Array<Record<string, any>>) {
  return {
    saveCallback: async () => ({ id: 'cb_1' }),
    markCallbackProcessed: async () => undefined,
    findByExternalId: async (externalId: string) =>
      prs.find((p) => p.externalId === externalId) ?? null,
    findById: async (id: string) => prs.find((p) => p.id === id) ?? null,
    updateStatus: async () => undefined,
  }
}

const fakeWallet = (calls: CreditCall[]) => ({
  credit: async (input: CreditCall) => {
    calls.push(input)
    return { balanceBefore: '0', balanceAfter: input.amount, ledgerEntryId: 'le_1', duplicate: false }
  },
})

const fakeUsers = { onDepositCompleted: async () => undefined }

describe('GAP-28: идемпотентность депозита по external_id провайдера', () => {
  it('NOWPayments: ключ проводки от payment_id, а не от id платёжки', async () => {
    // Две РАЗНЫЕ платёжки с одним внешним платежом (рассинхрон маппинга).
    const prs = [
      { id: 'pr_1', externalId: '42', userId: 'u1', status: 'pending', currency: 'USDT', amount: { toString: () => '10' } },
      { id: 'pr_2', externalId: '42', userId: 'u1', status: 'pending', currency: 'USDT', amount: { toString: () => '10' } },
    ]
    const calls: CreditCall[] = []
    const uc = new ProcessNOWPaymentsWebhookUseCase(
      fakeRepo(prs) as any,
      { verifyIPN: () => true } as any,
      fakeWallet(calls) as any,
      fakeUsers as any,
    )
    const body = { payment_id: 42, payment_status: 'finished', actually_paid: 10 }

    await uc.execute({ rawHeaders: {}, body, rawBody: '{}', ip: '1.2.3.4' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.idempotencyKey).toBe('deposit_nowpayments_42')

    // Доставка того же внешнего платежа через вторую платёжку: тот же ключ ->
    // в реальном ledger уникальный индекс отсечёт второе зачисление.
    await uc.execute({ rawHeaders: {}, body, rawBody: '{}', ip: '1.2.3.4' })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.idempotencyKey).toBe(calls[0]!.idempotencyKey)
  })

  it('NOWPayments: повторная доставка на ту же платёжку не доходит до credit (pr.completed)', async () => {
    const prs = [
      { id: 'pr_1', externalId: 'pay_7', userId: 'u1', status: 'completed', currency: 'USDT', amount: { toString: () => '10' } },
    ]
    const calls: CreditCall[] = []
    const uc = new ProcessNOWPaymentsWebhookUseCase(
      fakeRepo(prs) as any,
      { verifyIPN: () => true } as any,
      fakeWallet(calls) as any,
      fakeUsers as any,
    )
    await uc.execute({
      rawHeaders: {},
      body: { payment_id: 7, payment_status: 'finished' },
      rawBody: '{}',
      ip: '1.2.3.4',
    })
    expect(calls).toHaveLength(0)
  })

  it('Rukassa: ключ проводки от order_id, а не от id платёжки', async () => {
    const prs = [
      { id: 'pr_a', externalId: 'ord-100', userId: 'u2', status: 'pending', currency: 'RUB', amount: { toString: () => '500' }, method: 'card' },
      { id: 'pr_b', externalId: 'ord-100', userId: 'u2', status: 'pending', currency: 'RUB', amount: { toString: () => '500' }, method: 'card' },
    ]
    const calls: CreditCall[] = []
    const uc = new ProcessRukassaWebhookUseCase(
      fakeRepo(prs) as any,
      { verifyCallback: () => true } as any,
      fakeWallet(calls) as any,
      fakeUsers as any,
    )
    const body = { order_id: 'ord-100', status: 'success' }

    await uc.execute({ rawHeaders: { 'x-signature': 'ok' }, body, rawBody: '{}', ip: '1.2.3.4' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.idempotencyKey).toBe('deposit_rukassa_ord-100')
    expect(calls[0]!.amount).toBe('500')

    await uc.execute({ rawHeaders: { 'x-signature': 'ok' }, body, rawBody: '{}', ip: '1.2.3.4' })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.idempotencyKey).toBe(calls[0]!.idempotencyKey)
  })

  it('Rukassa: без external_id зачисления нет (guard no_external_id)', async () => {
    const calls: CreditCall[] = []
    const uc = new ProcessRukassaWebhookUseCase(
      fakeRepo([]) as any,
      { verifyCallback: () => true } as any,
      fakeWallet(calls) as any,
      fakeUsers as any,
    )
    await uc.execute({ rawHeaders: {}, body: { status: 'success' }, rawBody: '{}', ip: '1.2.3.4' })
    expect(calls).toHaveLength(0)
  })
})
