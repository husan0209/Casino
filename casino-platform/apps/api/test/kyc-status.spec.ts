/**
 * Юнит-тесты GetKycStatusUseCase — того, что игрок видит про верификацию.
 *
 * Смысл спеки не изменился: цифра на странице обязана быть тем же числом, по
 * которому сервер отказывает (общий источник — application/kyc-limits.ts и
 * application/withdrawn-total.ts). Изменилось то, ЧТО это за цифра:
 * 2026-10-07 порог переехал с пополнения на вывод (решение владельца), поэтому
 * полей `deposit_limit_rub` / `total_deposited_rub` в ответе больше нет —
 * показывать игроку «остаток лимита пополнения», которого как правила больше
 * нет, значит врать намеренно.
 */
import { GetKycStatusUseCase } from '../src/modules/kyc/application/use-cases/get-kyc-status.use-case'

import type {
  CountedWithdrawal,
  IKycRepository,
} from '../src/modules/kyc/domain/repositories/kyc.repository'

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
  // Курс настоящий по форме (money-строка), но фиктивный по значению: 92,5 ₽ за
  // USDT, чтобы «перевёл по курсу» было отличимо от «взял amount как ₽».
  const geo = {
    convertRubToDisplay: async (rub: string) => `${rub} RUB`,
    toRubEquivalent: (amount: string, currency: string) =>
      currency === 'RUB' ? amount : String(Number(amount) * 92.5),
  }
  const config = { get: () => undefined }

  it('порог не исчерпан: remaining = limit − withdrawn, конвертируется в display-валюту', async () => {
    const repo = makeRepo({ status: 'pending' }, [
      { currency: 'RUB', amount: '1000', amountRub: '1000' },
    ])
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1', 'USDT_TRC20')
    expect(res.withdraw_limit_rub).toBe('5000')
    expect(res.withdrawn_rub).toBe('1000')
    expect(res.withdraw_remaining_rub).toBe('4000')
    expect(res.withdraw_remaining).toBe('4000 RUB')
    expect(res.withdraw_currency).toBe('USDT_TRC20')
    expect(res.status).toBe('pending')
  })

  it('withdrawn > limit (существующее превышение): remaining = 0, не уходит в минус', async () => {
    const repo = makeRepo(null, [{ currency: 'RUB', amount: '7000', amountRub: '7000' }])
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

  it('строка без amount_rub переводится по курсу валюты заявки, а не берётся как ₽', async () => {
    // Так живут выводы до 2026-10-07: колонку RUB заполнял только депозитный
    // путь. 100 USDT по стенковому курсу 92,5 = 9 250 ₽, и вместе с 500 ₽ это
    // 9 750 ₽ — порог исчерпан. Если бы строку взяли как есть (100 ₽), остаток
    // показал бы 4 900 ₽ и страница пообещала бы вывод, в котором сервер откажет.
    const repo = makeRepo(null, [
      { currency: 'USDT_TRC20', amount: '100', amountRub: null },
      { currency: 'RUB', amount: '500', amountRub: '500' },
    ])
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1')
    expect(res.withdrawn_rub).toBe('9750')
    expect(res.withdraw_remaining_rub).toBe('0')
  })

  it('одобренному игроку поля порога не льстят: remaining считается, но статус первичен', async () => {
    // Approved вне порога (UI это знает по status и плашку не рисует). Числа
    // всё равно настоящие — их берёт то же правило, что и отказ.
    const repo = makeRepo({ status: 'approved' }, [
      { currency: 'RUB', amount: '6000', amountRub: '6000' },
    ])
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1')
    expect(res.status).toBe('approved')
    expect(res.withdrawn_rub).toBe('6000')
    expect(res.withdraw_remaining_rub).toBe('0')
  })
})
