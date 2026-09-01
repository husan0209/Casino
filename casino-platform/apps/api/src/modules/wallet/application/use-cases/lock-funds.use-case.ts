import { Inject, Injectable } from '@nestjs/common'

import type { Currency, MoneyAmount } from '@casino/shared-types'

import {
  IWalletLedger,
  WALLET_LEDGER,
  type CreditResult,
} from '../../domain/repositories/wallet.repository'

/** Вход use-case блокировки средств под вывод (GAP-22: семантика — в application). */
export interface LockFundsInput {
  userId: string
  currency: Currency
  amount: MoneyAmount
  idempotencyKey: string
}

/**
 * UC-WAL-03: блокировка средств под выплату.
 * Оркестрация — здесь (application); атомарная мутация и retry — в ledger
 * (infrastructure, за доменным интерфейсом IWalletLedger).
 */
@Injectable()
export class LockFundsUseCase {
  constructor(@Inject(WALLET_LEDGER) private ledger: IWalletLedger) {}
  execute(args: LockFundsInput): Promise<CreditResult> {
    return this.ledger.lock(args)
  }
}
