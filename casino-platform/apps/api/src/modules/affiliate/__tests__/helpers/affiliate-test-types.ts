/**
 * Ре-экспорт доменных типов для тестов.
 *
 * Существует, чтобы спеки импортировали типы коротким путём, не дублируя
 * объявления и не таща в тесты инфраструктурные классы.
 */
export type {
  AffiliateAttributionEntity,
  AffiliateClickEntity,
  AffiliateCommissionEntity,
  AffiliateEntity,
} from '../../domain/entities/affiliate.entity'
export type { AttributionForCalc } from '../../domain/repositories/affiliate.repository'
export type { CommissionOutcome } from '../../application/use-cases/create-commission.use-case'
