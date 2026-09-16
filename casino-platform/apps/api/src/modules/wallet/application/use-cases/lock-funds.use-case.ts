import { Inject, Injectable } from '@nestjs/common'

import {
  IWalletLedger,
  WALLET_LEDGER,
  type CreditResult,
  type WithdrawalOpArgs,
} from '../../domain/repositories/wallet.repository'

/**
 * GAP-55: LockFundsInput — форма та же, что у доменных аргументов вывода
 * (WithdrawalOpArgs): дублировать её в трёх use-case означало бы три точки
 * синхронизации при каждом новом поле (например metadata для ссылки на заявку).
 */
export type LockFundsInput = WithdrawalOpArgs

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
