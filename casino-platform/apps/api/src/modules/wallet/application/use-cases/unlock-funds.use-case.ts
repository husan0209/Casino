import { Inject, Injectable } from '@nestjs/common'

import type { Currency, MoneyAmount } from '@casino/shared-types'

import {
  IWalletLedger,
  WALLET_LEDGER,
  type CreditResult,
} from '../../domain/repositories/wallet.repository'

/** Вход use-case разблокировки средств (отмена/отказ выплаты). */
export interface UnlockFundsInput {
  userId: string
  currency: Currency
  amount: MoneyAmount
  idempotencyKey: string
}

/**
 * UC-WAL-04: разблокировка ранее заблокированных средств.
 * Атомарная мутация — в ledger (infrastructure).
 */
@Injectable()
export class UnlockFundsUseCase {
  constructor(@Inject(WALLET_LEDGER) private ledger: IWalletLedger) {}
  execute(args: UnlockFundsInput): Promise<CreditResult> {
    return this.ledger.unlock(args)
  }
}
