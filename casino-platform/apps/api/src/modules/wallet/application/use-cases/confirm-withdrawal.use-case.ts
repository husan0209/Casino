import { Inject, Injectable } from '@nestjs/common'

import type { Currency, MoneyAmount } from '@casino/shared-types'

import {
  IWalletLedger,
  WALLET_LEDGER,
  type CreditResult,
} from '../../domain/repositories/wallet.repository'

/** Вход use-case выплаты: debit + unlock атомарно. */
export interface ConfirmWithdrawalInput {
  userId: string
  currency: Currency
  amount: MoneyAmount
  idempotencyKey: string
}

/**
 * UC-WAL-05: подтверждение выплаты — списание баланса и снятие блокировки
 * одной транзакцией. Атомарная мутация — в ledger (infrastructure).
 */
@Injectable()
export class ConfirmWithdrawalUseCase {
  constructor(@Inject(WALLET_LEDGER) private ledger: IWalletLedger) {}
  execute(input: ConfirmWithdrawalInput): Promise<CreditResult> {
    return this.ledger.confirmWithdrawal(
      input.userId,
      input.currency,
      input.amount,
      input.idempotencyKey,
    )
  }
}
