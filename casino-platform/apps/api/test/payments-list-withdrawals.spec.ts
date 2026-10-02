/**
 * Юнит-тесты ListWithdrawalsUseCase (G21).
 *
 * Прокси в репозиторий с жёстким type:'withdrawal' — депозиты в этом
 * списке появиться не могут. Проверяем передачу аргументов и meta.
 */
import { ListWithdrawalsUseCase } from '../src/modules/payments/application/use-cases/list-withdrawals.use-case'
import type { IPaymentRequestRepository, PaymentRequest } from '../src/modules/payments/domain/payments.ports'

function pr(over: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: 'pr-w1',
    userId: 'u-1',
    type: 'withdrawal',
    status: 'pending',
    provider: 'manual',
    currency: 'RUB',
    amount: '500' as never,
    fee: '0' as never,
    idempotencyKey: 'wd_x',
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  } as unknown as PaymentRequest
}

type ListArgs = { userId: string; type?: 'deposit' | 'withdrawal'; page: number; perPage: number }

describe('ListWithdrawalsUseCase', () => {
  it('список с пагинацией: в репозиторий уходит type=withdrawal, meta отдаёт page/total', async () => {
    const got: ListArgs[] = []
    const repo = {
      listUser: async (args: ListArgs) => {
        got.push(args)
        return [[pr(), pr({ id: 'pr-w2' })], 2] as [PaymentRequest[], number]
      },
    } as unknown as IPaymentRequestRepository

    const res = await new ListWithdrawalsUseCase(repo).execute('u-1', 1, 20)

    expect(got).toEqual([{ userId: 'u-1', type: 'withdrawal', page: 1, perPage: 20 }])
    expect(res.items).toHaveLength(2)
    expect(res.meta).toEqual({ page: 1, total: 2 })
  })

  it('пустой список: items=[], total=0', async () => {
    const repo = {
      listUser: async () => [[], 0] as [PaymentRequest[], number],
    } as unknown as IPaymentRequestRepository
    const res = await new ListWithdrawalsUseCase(repo).execute('u-1', 3, 10)
    expect(res.items).toEqual([])
    expect(res.meta).toEqual({ page: 3, total: 0 })
  })

  it('отказ порта (listUser бросил) — ошибка пробрасывается', async () => {
    const repo = {
      listUser: async () => {
        throw new Error('db down')
      },
    } as unknown as IPaymentRequestRepository
    await expect(new ListWithdrawalsUseCase(repo).execute('u-1', 1, 10)).rejects.toThrow('db down')
  })
})
