/**
 * §12.4: guardrails автоматического отката A/B теста.
 *
 * Пороги приходят из `AB_GUARDRAILS` (`src/config.ts`), здесь их нет.
 * Метрики заполняет блок симуляции: этот файл только сравнивает числа и
 * решает, безопасен ли тест. Сам откат (§15.1 Level 1) делает feature flag,
 * см. `src/ab/feature-flags.ts`.
 *
 * Пограничные значения считаются строго по формулам §12.4: сравнение `>`
 * и `<`, поэтому ровно на пороге тест ещё безопасен.
 */
import { AB_GUARDRAILS } from '../config'

/**
 * Метрики тестовой группы (§12.4 + §12.3). Это агрегаты аналитики, а не
 * суммы кошелька: сравнение идёт только через отклонения и отношения,
 * денежной арифметики здесь нет, поэтому `number` допустим правилом ТЗ §12.4.
 *
 * Что обязан заполнить симулятор:
 * - `rtpDeviation` — отклонение cumulative RTP группы от целевого, в процентах
 *   (§11.1 cumulative rtp; знак любой, guardrail берёт модуль);
 * - `churnRate` — доля игроков группы, ушедших за 7 дней (§12.3 Churn Rate);
 * - `controlChurnRate` — та же метрика на control (§12.2);
 * - `arpu` — Revenue / users группы (§12.3 ARPU);
 * - `controlArpu` — ARPU control;
 * - `complaintsRate` — доля жалоб на «нечестную игру» (§12.4, дробь 0..1).
 */
export interface ABTestMetrics {
  rtpDeviation: number
  churnRate: number
  controlChurnRate: number
  arpu: number
  controlArpu: number
  complaintsRate: number
}

/** Форма guardrails из §12.4: те же четыре поля, что и в `AB_GUARDRAILS`. */
export interface ABTestGuardrails {
  maxRtpDeviation: number
  maxChurnIncrease: number
  minArpuRatio: number
  maxComplaintsRate: number
}

/** Вердикт ровно как в §12.4: безопасен ли тест и почему нет. */
export interface GuardrailCheckResult {
  safe: boolean
  reason?: string
}

/** Код нарушенного guardrail: стабильная метка для алерта и post-mortem (§15.6). */
export type GuardrailViolationCode =
  'INVALID_METRICS' | 'RTP_DEVIATION' | 'CHURN_INCREASE' | 'ARPU_DROP' | 'COMPLAINTS_RATE'

/** Нарушение с атрибуцией группы: §15.3 требует причина + группа в команде откатa. */
export interface GuardrailViolation {
  group: string
  code: GuardrailViolationCode
  reason: string
  measured: number
  limit: number
}

/** Guardrails по умолчанию — это §12.4 числа из конфига, ничего своего. */
export const DEFAULT_AB_GUARDRAILS: ABTestGuardrails = AB_GUARDRAILS

const METRIC_FIELDS: readonly (keyof ABTestMetrics)[] = [
  'rtpDeviation',
  'churnRate',
  'controlChurnRate',
  'arpu',
  'controlArpu',
  'complaintsRate',
]

/**
 * Все нарушения списка §12.4 по порядку: RTP, churn, ARPU, жалобы.
 * `checkGuardrails` берёт первое из них, поэтому тексты причин не расходятся.
 */
export function guardrailViolations(
  testGroup: string,
  metrics: ABTestMetrics,
  guardrails: ABTestGuardrails = DEFAULT_AB_GUARDRAILS,
): GuardrailViolation[] {
  const invalid = firstNonFiniteMetric(testGroup, metrics)
  if (invalid !== null) {
    return [invalid]
  }

  const violations: GuardrailViolation[] = []

  if (Math.abs(metrics.rtpDeviation) > guardrails.maxRtpDeviation) {
    violations.push({
      group: testGroup,
      code: 'RTP_DEVIATION',
      reason: `RTP deviation too high: ${metrics.rtpDeviation}%`,
      measured: Math.abs(metrics.rtpDeviation),
      limit: guardrails.maxRtpDeviation,
    })
  }

  const churnLimit = metrics.controlChurnRate * (1 + guardrails.maxChurnIncrease)
  if (metrics.churnRate > churnLimit) {
    violations.push({
      group: testGroup,
      code: 'CHURN_INCREASE',
      reason: `Churn rate increased: ${metrics.churnRate}`,
      measured: metrics.churnRate,
      limit: churnLimit,
    })
  }

  const arpuLimit = metrics.controlArpu * guardrails.minArpuRatio
  if (metrics.arpu < arpuLimit) {
    violations.push({
      group: testGroup,
      code: 'ARPU_DROP',
      reason: `ARPU dropped: ${metrics.arpu}`,
      measured: metrics.arpu,
      limit: arpuLimit,
    })
  }

  if (metrics.complaintsRate > guardrails.maxComplaintsRate) {
    violations.push({
      group: testGroup,
      code: 'COMPLAINTS_RATE',
      reason: `Complaints rate too high: ${metrics.complaintsRate}`,
      measured: metrics.complaintsRate,
      limit: guardrails.maxComplaintsRate,
    })
  }

  return violations
}

/**
 * §12.4: `Если ANY из условий нарушен — немедленный откат`. Возвращает
 * первое нарушение в порядке ТЗ; пустой ответ `{ safe: true }` без `reason`.
 */
export function checkGuardrails(
  testGroup: string,
  metrics: ABTestMetrics,
  guardrails: ABTestGuardrails = DEFAULT_AB_GUARDRAILS,
): GuardrailCheckResult {
  const violations = guardrailViolations(testGroup, metrics, guardrails)
  const firstViolation = violations[0]
  if (firstViolation === undefined) {
    return { safe: true }
  }
  return { safe: false, reason: firstViolation.reason }
}

/**
 * Метрики NaN или Infinity означают сломанный прогон симулятора. §12.4 не
 * описывает такой вход, а молчаливый `safe: true` на битых числах опаснее
 * откатa: трактuem как нарушение и не даём дальше считать отношения.
 */
function firstNonFiniteMetric(
  testGroup: string,
  metrics: ABTestMetrics,
): GuardrailViolation | null {
  for (const field of METRIC_FIELDS) {
    const value = metrics[field]
    if (Number.isFinite(value) === false) {
      return {
        group: testGroup,
        code: 'INVALID_METRICS',
        reason: `Metric ${field} is not a finite number: ${value}`,
        measured: value,
        limit: Number.NaN,
      }
    }
  }
  return null
}
