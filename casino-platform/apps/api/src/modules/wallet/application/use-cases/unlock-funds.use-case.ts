import { Inject, Injectable } from '@nestjs/common'

import {
  IWalletLedger,
  WALLET_LEDGER,
  type CreditResult,
  type WithdrawalOpArgs,
} from '../../domain/repositories/wallet.repository'

/**
 * GAP-55: UnlockFundsInput — форма та же, что у доменных аргументов вывода
 * (WithdrawalOpArgs): дублировать её в трёх use-case означало бы три точки
 * синхронизации при каждом новом поле (например metadata для ссылки на заявку).
 */
export type UnlockFundsInput = WithdrawalOpArgs

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
