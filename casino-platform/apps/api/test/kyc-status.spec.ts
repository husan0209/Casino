import { GetKycStatusUseCase } from '../src/modules/kyc/application/use-cases/get-kyc-status.use-case'
import type { IKycRepository } from '../src/modules/kyc/domain/repositories/kyc.repository'

function makeRepo(status: { status: string } | null, total: string): IKycRepository {
  return {
    getStatus: async () => status as never,
    getTotalDepositedRub: async () => total,
  } as unknown as IKycRepository
}

describe('GetKycStatusUseCase', () => {
  const geo = { convertRubToDisplay: async (rub: string) => `${rub} RUB` }
  const config = { get: () => undefined }

  it('лимит не исчерпан: remaining = limit − total, конвертируется в display-валюту', async () => {
    const repo = makeRepo({ status: 'pending' }, '1000')
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1', 'USDT_TRC20')
    expect(res.deposit_limit_rub).toBe('5000')
    expect(res.total_deposited_rub).toBe('1000')
    expect(res.limit_remaining).toBe('4000 RUB')
    expect(res.limit_currency).toBe('USDT_TRC20')
    expect(res.status).toBe('pending')
  })

  it('total > limit (существующее превышение): remaining = 0, не уходит в минус', async () => {
    const repo = makeRepo(null, '7000')
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1')
    expect(res.limit_remaining).toBe('0 RUB')
    expect(res.limit_currency).toBe('RUB')
  })

  it('total отсутствует в БД → считается нулём', async () => {
    const repo = makeRepo(null, '0')
    const uc = new GetKycStatusUseCase(repo, geo as never, config as never)
    const res = await uc.execute('user-1')
    expect(res.total_deposited_rub).toBe('0')
    expect(res.limit_remaining).toBe('5000 RUB')
  })

  it('кастомный лимит из KYC_DEPOSIT_LIMIT_RUB используется вместо дефолта', async () => {
    const repo = makeRepo(null, '0')
    const cfg = { get: (key: string) => (key === 'KYC_DEPOSIT_LIMIT_RUB' ? '10000' : undefined) }
    const uc = new GetKycStatusUseCase(repo, geo as never, cfg as never)
    const res = await uc.execute('user-1')
    expect(res.deposit_limit_rub).toBe('10000')
  })
})
