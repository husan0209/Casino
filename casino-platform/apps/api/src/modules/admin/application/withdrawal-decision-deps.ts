/**
 * Общие зависимости сценариев решения по заявке на вывод (В3).
 *
 * Файл НЕ назван `*.use-case.ts`: это не сценарий, а тип-упаковка портов,
 * которыми пользуются `approve-withdrawal.use-case.ts` и
 * `reject-withdrawal.use-case.ts`.
 */
import { type WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type AuditLogService } from './audit-log.service'
import { type IWithdrawalRequestStore } from '../domain/withdrawal.repository'

/** Порты, которые уже инжектятся `AdminFinanceController` (см. admin.module.ts). */
export interface WithdrawalDecisionDependencies {
  /** Реализация — `PAYMENT_REQUEST_REPOSITORY` (порт домена payments). */
  payments: IWithdrawalRequestStore
  wallet: WalletFacade
  audit: AuditLogService
}

/**
 * Кто и откуда принял решение.
 *
 * `ipAddress`/`userAgent` передаются строками, а не объектом `Request`:
 * application-слой не должен знать про express (AI_DEVELOPMENT_RULES §3.2),
 * иначе сценарий нельзя переиспользовать из job-и или консольной команды.
 */
export interface WithdrawalDecisionContext {
  actorId: string
  ipAddress?: string | undefined
  userAgent?: string | undefined
}
