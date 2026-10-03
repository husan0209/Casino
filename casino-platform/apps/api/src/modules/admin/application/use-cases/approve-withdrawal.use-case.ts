/**
 * UC-PAY-11: одобрение заявки на вывод (админ-финансы).
 *
 * ВОЛНА В3. Раньше эта последовательность («проверить статус → списать
 * заблокированные средства через кошелёк → перевести заявку в completed →
 * написать в аудит») стояла в приватном методе `approveOne` контроллера
 * `admin-finance.controller.ts`, и presentation-слой сам вызывал
 * `payments.updateStatus` — прямая запись в БД из HTTP-слоя. Логика перенесена
 * в application, контроллер передаёт только HTTP-данные.
 *
 * ПОЧЕМУ ЗАВИСИМОСТИ ПЕРЕДАЮТСЯ АРГУМЕНТОМ, А НЕ ЧЕРЕЗ @Inject.
 * Класс-провайдер нужно регистрировать в `admin.module.ts`, а этот файл сейчас
 * занят другой задачей (регистрация settings/notifications-провайдеров), и
 * править его в этой волне нельзя. Функция получает те же порты, которые уже
 * инжектятся контроллеру (`PAYMENT_REQUEST_REPOSITORY`, `WalletFacade`,
 * `AuditLogService`): DI-граф не меняется, записи из presentation больше нет.
 * Когда admin.module.ts освободится, тело переезжает в
 * `@Injectable() ApproveWithdrawalUseCase` без изменения контракта — см. отчёт.
 *
 * ПОРЯДОК ШАГОВ ВАЖЕН: сначала списание (оно идемпотентно по ключу
 * `wd_confirm_<id>`), затем статус заявки. Обратный порядок оставил бы заявку
 * «completed» при отказе кошелька.
 */
import { type Currency } from '@casino/shared-types'

import { WithdrawalInvalidStatusError } from '../../domain/errors'
import {
  type WithdrawalDecisionContext,
  type WithdrawalDecisionDependencies,
} from '../withdrawal-decision-deps'

export interface ApproveWithdrawalInput {
  paymentRequestId: string
  context: WithdrawalDecisionContext
}

/**
 * Списание по одобренной заявке тоже несёт ссылку на неё (GAP-55 §11), а
 * повторное одобрение той же заявки отбивается проверкой статуса, а не
 * идемпотентным ключом кошелька.
 */
export async function approveWithdrawal(
  deps: WithdrawalDecisionDependencies,
  input: ApproveWithdrawalInput,
): Promise<void> {
  const withdrawal = await deps.payments.findById(input.paymentRequestId)
  if (withdrawal?.type !== 'withdrawal' || withdrawal.status !== 'pending') {
    throw new WithdrawalInvalidStatusError()
  }

  await deps.wallet.confirmWithdrawal({
    userId: withdrawal.userId,
    currency: withdrawal.currency as Currency,
    amount: withdrawal.amount.toString(),
    idempotencyKey: `wd_confirm_${withdrawal.id}`,
    metadata: { payment_request_id: withdrawal.id },
  })

  await deps.payments.updateStatus(withdrawal.id, 'completed', { completedAt: new Date() })

  await deps.audit.log({
    actorType: 'admin',
    actorId: input.context.actorId,
    action: 'admin.withdrawal.approved',
    targetType: 'payment_request',
    targetId: withdrawal.id,
    ipAddress: input.context.ipAddress,
    userAgent: input.context.userAgent,
  })
}
