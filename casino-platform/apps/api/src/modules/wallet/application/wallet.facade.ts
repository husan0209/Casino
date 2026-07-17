import { Inject, Injectable } from '@nestjs/common'
import { IWalletLedger, IWalletRepository, WALLET_LEDGER, WALLET_REPOSITORY, CreditInput } from '../domain/repositories/wallet.repository'
import type { Currency, MoneyAmount } from '@casino/shared-types'
@Injectable()
export class WalletFacade {
  constructor(
    @Inject(WALLET_LEDGER) private ledger: IWalletLedger,
    @Inject(WALLET_REPOSITORY) private repo: IWalletRepository,
  ) {}
  credit(input: CreditInput) { return this.ledger.credit(input) }
  debit(input: CreditInput) { return this.ledger.debit(input) }
  lock(userId: string, currency: Currency, amount: MoneyAmount, key: string) { return this.ledger.lock(userId, currency, amount, key) }
  unlock(userId: string, currency: Currency, amount: MoneyAmount, key: string) { return this.ledger.unlock(userId, currency, amount, key) }
  confirmWithdrawal(userId: string, currency: Currency, amount: MoneyAmount, key: string) { return this.ledger.confirmWithdrawal(userId, currency, amount, key) }
  getBalances(userId: string) { return this.repo.listBalances(userId) }
  async getBalance(userId: string, currency: Currency) {
    let w = await this.repo.getBalance(userId, currency)
    if (!w) return { currency, balance: '0', locked: '0', available: '0' }
    const { money } = await import('@casino/shared-utils')
    return { currency, balance: w.balance, locked: w.locked, available: money.subtract(w.balance, w.locked) }
  }
}
