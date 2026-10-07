/**
 * Единый источник двух KYC-порогов (`KYC_DEPOSIT_LIMIT_RUB`, `KYC_WITHDRAW_LIMIT_RUB`).
 *
 * Почему файл отдельный: `KycCheckService` (серверный отказ на выводе) и
 * `GetKycStatusUseCase` (цифра, которую видит игрок на /kyc) читали порог
 * по-разному — первый хардкодил '5000', вторая — env. При
 * `KYC_DEPOSIT_LIMIT_RUB=10000` UI обещал 10 000 ₽, а сервер вёл себя как
 * 5 000 ₽. Оба места зовут отсюда, разойтись значения больше нечем.
 *
 * Два порога живут рядом намеренно и НЕ сливаются в один ключ:
 * - депозитный (2026-10-07) ничего не запрещает — по нему пишут риск-лог при
 *   зачислении (`escalateOverDepositLimit`), потому что пополнение свободно;
 * - выводный — отказ: до него деньги отдаются без верификации (заявку всё
 *   равно подтверждает оператор), выше — `KycRequiredError`.
 * Общее число связало бы два разных решения: правка AML-мониторинга начала бы
 * менять сумму, за которой игроку нужен паспорт.
 *
 * Ловушка типизации (почему `get<string>` тут соврёт):
 * `packages/shared-config/src/env.validation.ts` объявляет ключи как
 * `z.coerce.number()`, то есть в рантайме `ConfigService.get(...)` отдаёт
 * ЧИСЛО (5000), а не строку. Число — не деньги (AI_DEVELOPMENT_RULES §1),
 * поэтому значение приводится к money-строке здесь, на границе
 * «конфиг → деньги», и все потребители получают ровно один и тот же формат.
 */
import type { ConfigService } from '@nestjs/config'

/** Дефолты: совпадают с дефолтами env-схемы. */
const DEFAULT_DEPOSIT_LIMIT_RUB = '5000'
const DEFAULT_WITHDRAW_LIMIT_RUB = '5000'

/**
 * Порог из конфигурации. Ключ может прийти числом (валидированный env),
 * строкой (переопределение/тест-фикс) или отсутствовать — всё сводится
 * к money-строке.
 */
function readLimitRub(raw: string | number | undefined | null, fallback: string): string {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : fallback
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim()
  }
  return fallback
}

/** Порог риск-лога по суммарным пополнениям. Отказа не вызывает. */
export function kycDepositLimitRub(config: ConfigService): string {
  return readLimitRub(
    config.get<string | number>('KYC_DEPOSIT_LIMIT_RUB'),
    DEFAULT_DEPOSIT_LIMIT_RUB,
  )
}

/** Порог вывода без верификации, ₽. Выше — `KycRequiredError`. */
export function kycWithdrawLimitRub(config: ConfigService): string {
  return readLimitRub(
    config.get<string | number>('KYC_WITHDRAW_LIMIT_RUB'),
    DEFAULT_WITHDRAW_LIMIT_RUB,
  )
}
