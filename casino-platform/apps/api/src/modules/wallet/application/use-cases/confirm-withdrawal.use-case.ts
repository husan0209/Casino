import { Inject, Injectable } from '@nestjs/common'

import {
  IWalletLedger,
  WALLET_LEDGER,
  type CreditResult,
  type WithdrawalOpArgs,
} from '../../domain/repositories/wallet.repository'

/**
 * GAP-55: ConfirmWithdrawalInput — форма та же, что у доменных аргументов вывода
 * (WithdrawalOpArgs): дублировать её в трёх use-case означало бы три точки
 * синхронизации при каждом новом поле (например metadata для ссылки на заявку).
 */
export type ConfirmWithdrawalInput = WithdrawalOpArgs

/**
 * UC-WAL-05: подтверждение выплаты — списание баланса и снятие блокировки
 * одной транзакцией. Атомарная мутация — в ledger (infrastructure).
 */
@Injectable()
export class ConfirmWithdrawalUseCase {
  constructor(@Inject(WALLET_LEDGER) private ledger: IWalletLedger) {}
  execute(args: ConfirmWithdrawalInput): Promise<CreditResult> {
    return this.ledger.confirmWithdrawal(args)
  }
}
