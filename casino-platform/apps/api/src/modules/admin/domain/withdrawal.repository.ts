/**
 * Узкий порт доступа admin-модуля к платёжным заявкам (Волна В3).
 *
 * ЗАЧЕМ ОН НУЖЕН. Одобрение/отклонение вывода — это операции admin-модуля над
 * чужим агрегатом (`payment_request` принадлежит payments). Раньше контроллер
 * `admin-finance.controller.ts` инжектировал `IPaymentRequestRepository` и сам
 * вызывал `updateStatus`, то есть presentation-слой писал в БД (нарушение
 * AI_DEVELOPMENT_RULES §3.3: «БД только в infrastructure/repositories», а
 * логика — в application/use-cases).
 *
 * ПОЧЕМУ НЕ ИМПОРТ ПОРТА PAYMENTS НАПРЯМУЮ. `@modules/payments/domain/...` из
 * application-слоя admin — это кросс-модульный deep-импорт мимо фасада: он
 * ловится гвардом G16 (`tech-debt check cross-module-imports`) и увеличил бы
 * замороженный базлайн. Поэтому admin описывает СВОЙ минимальный контракт
 * (интерфейс-потребитель), под который существующий payments-порт подходит
 * структурно: реализацию по-прежнему даёт `PAYMENT_REQUEST_REPOSITORY`.
 *
 * Типы строк — type-only `@prisma/client` (конвенция репо для domain,
 * AI_DEVELOPMENT_RULES §3.2): рантайм-зависимости domain от БД нет.
 */
import type { PaymentStatus } from '@prisma/client'

/**
 * Заявка на вывод в том объёме, который нужен сценариям admin.
 *
 * `amount` — не `number` и не строка: Prisma отдаёт Decimal, а деньги наружу
 * уходят строкой (G20), поэтому контракт требует только `toString()`.
 */
export interface AdminWithdrawalRow {
  id: string
  userId: string
  currency: string
  amount: { toString(): string }
  type: string
  status: string
}

/** Минимальная поверхность заявок, востребованная admin-финансами. */
export interface IWithdrawalRequestStore {
  findById(id: string): Promise<AdminWithdrawalRow | null>
  updateStatus(
    id: string,
    status: PaymentStatus,
    extra?: {
      completedAt?: Date | undefined
      errorMessage?: string | undefined
    },
  ): Promise<unknown>
}
