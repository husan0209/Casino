import { LockFundsUseCase } from '../src/modules/wallet/application/use-cases/lock-funds.use-case'
import { UnlockFundsUseCase } from '../src/modules/wallet/application/use-cases/unlock-funds.use-case'
import { ConfirmWithdrawalUseCase } from '../src/modules/wallet/application/use-cases/confirm-withdrawal.use-case'
import { UnlockExceedsLockedError } from '../src/modules/wallet/domain/errors'
import type { CreditResult, IWalletLedger, WithdrawalOpArgs } from '../src/modules/wallet/domain/repositories/wallet.repository'

function makeLedger(): { ledger: IWalletLedger; calls: Array<{ op: string; args: unknown }> } {
  const calls: Array<{ op: string; args: unknown }> = []
  const ledger = {
    lock: async (args: WithdrawalOpArgs) => {
      calls.push({ op: 'lock', args })
      return { balanceAfter: '90.00', ledgerEntryId: 'le-1' } as CreditResult
    },
    unlock: async (args: WithdrawalOpArgs) => {
      calls.push({ op: 'unlock', args })
      return { balanceAfter: '100.00', ledgerEntryId: 'le-2' } as CreditResult
    },
    confirmWithdrawal: async (args: WithdrawalOpArgs) => {
      calls.push({ op: 'confirm', args })
      return { balanceAfter: '100.00', ledgerEntryId: 'le-3' } as CreditResult
    },
  } as unknown as IWalletLedger
  return { ledger, calls }
}

const args = (over: Partial<WithdrawalOpArgs> = {}): WithdrawalOpArgs => ({
  userId: 'user-1',
  currency: 'RUB',
  amount: '10.00',
  idempotencyKey: 'wd_test_1',
  ...over,
}) as WithdrawalOpArgs

describe('Wallet withdrawal use-cases (делегирование в ledger)', () => {
  it('LockFundsUseCase пробрасывает аргументы 1-в-1 в ledger.lock', async () => {
    const { ledger, calls } = makeLedger()
    const res = await new LockFundsUseCase(ledger).execute(args())
    expect(res.balanceAfter).toBe('90.00')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.op).toBe('lock')
    expect(calls[0]!.args).toEqual(args())
  })

  it('UnlockFundsUseCase делегирует в ledger.unlock', async () => {
    const { ledger, calls } = makeLedger()
    const res = await new UnlockFundsUseCase(ledger).execute(args())
    expect(res.balanceAfter).toBe('100.00')
    expect(calls[0]!.op).toBe('unlock')
  })

  it('ConfirmWithdrawalUseCase делегирует в ledger.confirmWithdrawal', async () => {
    const { ledger, calls } = makeLedger()
    const res = await new ConfirmWithdrawalUseCase(ledger).execute(args())
    expect(res.ledgerEntryId).toBe('le-3')
    expect(calls[0]!.op).toBe('confirm')
  })

  it('ошибка ledger пробрасывается наверх без изменений (UnlockExceedsLockedError)', async () => {
    const ledger = {
      unlock: async () => {
        throw new UnlockExceedsLockedError()
      },
    } as unknown as IWalletLedger
    await expect(new UnlockFundsUseCase(ledger).execute(args())).rejects.toBeInstanceOf(
      UnlockExceedsLockedError,
    )
  })
})
