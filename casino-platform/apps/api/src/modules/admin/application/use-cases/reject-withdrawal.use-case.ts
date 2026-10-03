/**
 * UC-PAY-12: отклонение заявки на вывод (админ-финансы).
 *
 * ВОЛНА В3: проверка статуса, разблокировка средств, перевод заявки в
 * `cancelled` и запись в аудит жили в приватном методе `rejectOne` контроллера,
 * то есть presentation-слой писал в `payment_request` напрямую. Логика
 * перенесена в application; способ передачи зависимостей — см.
 * `approve-withdrawal.use-case.ts` (общая причина: занят `admin.module.ts`).
 *
 * Ключ разблокировки включает `randomUUID()`: одна и та же заявка может быть
 * отклонена повторно после правки данных, а идемпотентность здесь должна
 * защищать от двойного разблокирования, а не от повторного вызова решения.
 */
import { randomUUID } from 'node:crypto'

import { type Currency } from '@casino/shared-types'

import { WithdrawalInvalidStatusError } from '../../domain/errors'
import {
  type WithdrawalDecisionContext,
  type WithdrawalDecisionDependencies,
} from '../withdrawal-decision-deps'

export interface RejectWithdrawalInput {
  paymentRequestId: string
  /** Причина отклонения: уходит в `payment_request.error_message` и в аудит. */
  reason?: string | undefined
  context: WithdrawalDecisionContext
}

export async function rejectWithdrawal(
  deps: WithdrawalDecisionDependencies,
  input: RejectWithdrawalInput,
): Promise<void> {
  const withdrawal = await deps.payments.findById(input.paymentRequestId)
  if (withdrawal?.type !== 'withdrawal' || withdrawal.status !== 'pending') {
    throw new WithdrawalInvalidStatusError()
  }

  await deps.wallet.unlock({
    userId: withdrawal.userId,
    currency: withdrawal.currency as Currency,
    amount: withdrawal.amount.toString(),
    idempotencyKey: `wd_unlock_${withdrawal.id}_${randomUUID()}`,
  })

  await deps.payments.updateStatus(withdrawal.id, 'cancelled', { errorMessage: input.reason })

  await deps.audit.log({
    actorType: 'admin',
    actorId: input.context.actorId,
    action: 'admin.withdrawal.rejected',
    targetType: 'payment_request',
    targetId: withdrawal.id,
    payload: { reason: input.reason },
    ipAddress: input.context.ipAddress,
  })
}
