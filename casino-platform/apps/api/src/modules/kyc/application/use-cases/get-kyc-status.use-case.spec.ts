/**
 * Юнит-тесты GetKycStatusUseCase (G21 требует спек рядом с use-case).
 *
 * Смысл спеки не изменился: цифра на странице обязана быть тем же числом, по
 * которому сервер отказывает (общий источник — application/kyc-limits.ts и
 * application/withdrawn-total.ts). Изменилось то, ЧТО это за цифра: 2026-10-07
 * порог переехал с пополнения на вывод (решение владельца), поэтому полей
 * `deposit_limit_rub` / `total_deposited_rub` в ответе нет — показать игроку
 * «остаток лимита пополнения», когда такого правила больше нет, значит врать.
 */
import { GetKycStatusUseCase } from './get-kyc-status.use-case'

import type { CountedWithdrawal, IKycRepository } from '../../domain/repositories/kyc.repository'

const row = (
  amountRub: string | null,
  currency = 'RUB',
  amount = amountRub ?? '0',
): CountedWithdrawal => ({ currency, amount, amountRub })

function makeRepo(
  status: { status: string } | null,
  withdrawals: CountedWithdrawal[],
): IKycRepository {
  return {
    getStatus: async () => status as never,
    listCountedWithdrawals: async () => withdrawals,
  } as unknown as IKycRepository
}

describe('GetKycStatusUseCase', () => {
  // Курс фиктивный и круглый (92,5 ₽ за USDT): перевод обязан быть виден в
  // ответе, иначе строки старых выводов молча сойдут нулём.
  const geo = {
    convertRubToDisplay: async (rub: string) => `${rub} RUB`,
    convertToRubAtLiveRate: (amount: string, currency: string) =>
      currency === 'RUB' ? amount : String(Number(amount) * 92.5),
  }
  const config = { get: () => undefined }

  it('порог не исчерпан: remaining = limit − withdrawn, в display-валюте', async () => {
    const repo = makeRepo({ status: 'pending' }, [row('1000')])
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1', 'USDT_TRC20')
    expect(res.withdraw_limit_rub).toBe('5000')
    expect(res.withdrawn_rub).toBe('1000')
    expect(res.withdraw_remaining_rub).toBe('4000')
    expect(res.withdraw_remaining).toBe('4000 RUB')
    expect(res.withdraw_currency).toBe('USDT_TRC20')
    expect(res.status).toBe('pending')
  })

  it('withdrawn > limit (сущ. превышение): remaining = 0, не уходит в минус', async () => {
    const repo = makeRepo(null, [row('7000')])
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1')
    expect(res.withdraw_remaining).toBe('0 RUB')
    expect(res.withdraw_currency).toBe('RUB')
  })

  it('история отсутствует → выведено 0, доступна вся сумма порога', async () => {
    const repo = makeRepo(null, [])
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1')
    expect(res.withdrawn_rub).toBe('0')
    expect(res.withdraw_remaining).toBe('5000 RUB')
  })

  it('кастомный порог из KYC_WITHDRAW_LIMIT_RUB используется вместо дефолта', async () => {
    const repo = makeRepo(null, [])
    const cfg = { get: (key: string) => (key === 'KYC_WITHDRAW_LIMIT_RUB' ? '10000' : undefined) }
    const uc = new GetKycStatusUseCase(repo, geo as never, cfg as never)
    const res = await uc.execute('user-1')
    expect(res.withdraw_limit_rub).toBe('10000')
    expect(res.withdraw_remaining).toBe('10000 RUB')
  })

  it('строка без amount_rub переводится по курсу, а не берётся как ₽', async () => {
    // 100 USDT по курсу = 9 250 ₽, и с 500 ₽ это 9 750 ₽ — порог исчерпан.
    // Если взять сумму как есть (100 ₽), страница пообещала бы 4 900 ₽ остатка,
    // а сервер бы на этом же выводе отказал.
    const repo = makeRepo(null, [row(null, 'USDT_TRC20', '100'), row('500')])
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1')
    expect(res.withdrawn_rub).toBe('9750')
    expect(res.withdraw_remaining_rub).toBe('0')
  })
})
