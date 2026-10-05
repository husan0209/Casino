/**
 * Единый источник правды порога депозитов без KYC (`KYC_DEPOSIT_LIMIT_RUB`).
 *
 * Почему файл отдельный: `KycCheckService` (серверная проверка на интенте
 * депозита) и `GetKycStatusUseCase` (цифра, которую видит игрок на /kyc)
 * читали порог по-разному — первый хардкодил '5000', вторая — env. При
 * `KYC_DEPOSIT_LIMIT_RUB=10000` UI обещал 10 000 ₽, а сервер вёл себя как
 * 5 000 ₽. Оба места зовут отсюда, разойтись значения больше нечем.
 *
 * Ловушка типизации (почему `get<string>` тут соврёт):
 * `packages/shared-config/src/env.validation.ts:92` объявляет ключ как
 * `z.coerce.number()`, то есть в рантайме `ConfigService.get(...)` отдаёт
 * ЧИСЛО (5000), а не строку. Число — не деньги (AI_DEVELOPMENT_RULES §1),
 * поэтому значение приводится к money-строке здесь, на границе
 * «конфиг → деньги», и оба потребителя получают ровно один и тот же формат.
 * Саму env-схему не правим: она общий файл вне объёма задачи, а
 * `5000.00` из docs/ENVIRONMENT_VARIABLES.md через coerce проходит.
 */
import type { ConfigService } from '@nestjs/config'

/** Дефолт порога: совпадает с дефолтом env-схемы (env.validation.ts:92). */
const DEFAULT_KYC_DEPOSIT_LIMIT_RUB = '5000'

/**
 * Порог из конфигурации. Ключ может прийти числом (валидированный env),
 * строкой (переопределение/тест-фикс) или отсутствовать — всё сводится
 * к money-строке.
 */
export function kycDepositLimitRub(config: ConfigService): string {
  return normalizeDepositLimitRub(config.get<string | number>('KYC_DEPOSIT_LIMIT_RUB'))
}

/** Нормализация значения порога к money-строке (см. шапку файла). */
function normalizeDepositLimitRub(raw: string | number | undefined | null): string {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : DEFAULT_KYC_DEPOSIT_LIMIT_RUB
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim()
  }
  return DEFAULT_KYC_DEPOSIT_LIMIT_RUB
}
