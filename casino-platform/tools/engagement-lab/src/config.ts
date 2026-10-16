/**
 * Все числа Части 9 в одном месте. Каждый блок ссылается на раздел ТЗ.
 * Числа, которых в ТЗ нет, помечены `lab default` и собраны в README
 * отдельным списком — их нельзя выдумывать молча.
 */
import { EngagementPhase } from './domain/engagement-phase'
import { type MoneyAmount } from './domain/types'

export const RING_BUFFER_SIZE = 100

/** §17: жёсткие границы RTP. */
export const RTP_FLOOR = 90
export const RTP_CEILING = 110

/** §4.2 и §10.2: цикл управления балансом. */
export const BALANCE_CYCLE = {
  onboardingSpinThreshold: 15,
  onboardingTargetRatio: 1.25,
  pillowRatioMin: 1.2,
  pillowRatioMax: 1.3,
  riskBalanceRatio: 0.5,
  reactivationThresholdRatio: 0.2,
  reactivationTargetRatioMin: 0.7,
  reactivationTargetRatioMax: 0.8,
  maxReactivations: 4,
  /** §4.3 MIN_SPINS_BETWEEN_REACTIVATIONS в ТЗ не названо — lab default. */
  minSpinsBetweenReactivations: 10,
  /** §5.2 REACTIVATION → RETENTION: spinsSinceReactivation >= 3. */
  spinsToLeaveReactivation: 3,
  retentionDrainPer10Spins: 0.175,
} as const

/** §5.3 и §14.1: неактивность и паузы. */
export const TIMING = {
  dormantAfterMs: 30 * 60 * 1000,
  longPauseAfterLossMs: 30_000,
  slowSpinIntervalMs: 15_000,
  minuteMs: 60_000,
  fiveMinutesMs: 300_000,
} as const

/** §6.2: окна и пороги поведенческих сигналов. */
export const BEHAVIOR = {
  recentTimestampWindow: 10,
  recentBetsWindow: 10,
  rapidClicksPerMinute: 10,
  slowClicksPerMinute: 3,
  betTrendIncreasingFactor: 1.15,
  betTrendDecreasingFactor: 0.85,
  balanceNearZeroRatio: 0.1,
} as const

/** §6.1: формула Engagement Score. */
export const SCORE_WEIGHTS = {
  base: 50,
  winStreakStep: 5,
  winStreakCap: 20,
  lossStreakStep: 4,
  lossStreakCap: 30,
  activityStep: 0.5,
  activityCap: 15,
  churnPenaltyCap: 25,
} as const

/**
 * §6.1 churnRiskPenalty: ТЗ задал только диапазон 0–25 и не дал формулу.
 * Веса ниже — lab default, зафиксированы, чтобы симуляция была повторяемой.
 */
export const CHURN_RISK_PENALTIES = {
  slowClicking: 8,
  decreasingBetCount: 6,
  longPauseAfterLoss: 5,
  balanceNearZero: 6,
} as const

/** §7.2: диапазоны целевого RTP по фазам. */
export const RTP_RANGES: Record<EngagementPhase, { min: number; max: number }> = {
  [EngagementPhase.ONBOARDING]: { min: 105, max: 110 },
  [EngagementPhase.RETENTION]: { min: 94, max: 98 },
  [EngagementPhase.RISK]: { min: 98, max: 102 },
  [EngagementPhase.REACTIVATION]: { min: 103, max: 108 },
  [EngagementPhase.COOLDOWN]: { min: 96, max: 96 },
  [EngagementPhase.DORMANT]: { min: 96, max: 96 },
}

/**
 * §5.3: целевая доля выигрышных спинов по фазам. Нужна симуляции, чтобы
 * отличать «чаще мелкие выплаты» от «реально щедрее игра».
 */
export const HIT_RATE_RANGES: Record<EngagementPhase, { min: number; max: number }> = {
  [EngagementPhase.ONBOARDING]: { min: 0.4, max: 0.5 },
  [EngagementPhase.RETENTION]: { min: 0.3, max: 0.35 },
  [EngagementPhase.RISK]: { min: 0.35, max: 0.4 },
  [EngagementPhase.REACTIVATION]: { min: 0.5, max: 0.6 },
  [EngagementPhase.COOLDOWN]: { min: 0.3, max: 0.3 },
  [EngagementPhase.DORMANT]: { min: 0.3, max: 0.3 },
}

/** §7.1 и §7.3: поведенческая корректировка, дрейф, сглаживание. */
export const RTP_TUNING = {
  behaviorModifiers: {
    rapidClicking: -2,
    betTrendIncreasing: -1,
    slowClicking: 3,
    decreasingBetCount: 2,
    longPauseAfterLoss: 2,
  },
  driftNoiseBandPercent: 2,
  driftCompensationFactor: 0.1,
  driftCompensationCap: 3,
  maxRtpChangePerSpin: 2,
} as const

/** §8.1: LDW. */
export const LDW_CONFIG = {
  minPayoutRatio: 0.3,
  maxPayoutRatio: 0.6,
  ditherRange: 0.05,
  targetFrequency: {
    [EngagementPhase.ONBOARDING]: 0.15,
    [EngagementPhase.RETENTION]: 0.25,
    [EngagementPhase.RISK]: 0.3,
    [EngagementPhase.REACTIVATION]: 0.2,
    [EngagementPhase.COOLDOWN]: 0,
    [EngagementPhase.DORMANT]: 0,
  } as Record<EngagementPhase, number>,
} as const

/** §8.2: Near-Miss. */
export const NEAR_MISS_CONFIG = {
  ditherRange: 0.05,
  /** Выплата-окно: строка считается near-miss, только если платит мало. */
  maxPayoutMultiplier: 2,
  rateByPhase: {
    [EngagementPhase.ONBOARDING]: 0.1,
    [EngagementPhase.RETENTION]: 0.15,
    [EngagementPhase.RISK]: 0.2,
    [EngagementPhase.REACTIVATION]: 0.25,
    [EngagementPhase.COOLDOWN]: 0,
    [EngagementPhase.DORMANT]: 0,
  } as Record<EngagementPhase, number>,
} as const

/** §13.2: параметры симуляции. */
export const SIMULATION_DEFAULTS = {
  numSessions: 10_000,
  avgSessionSpins: 75,
  depositMin: 500,
  depositMax: 5000,
  betStrategy: 'random' as 'fixed' | 'random' | 'martingale',
  maxReactivations: 4,
  seed: 20261015,
} as const

/** §13.4: критерии успешности прогона. */
export const SIMULATION_SUCCESS_CRITERIA = {
  cumulativeRtpMin: 94,
  cumulativeRtpMax: 98,
  cumulativeRtpTarget: 96,
  cumulativeRtpTolerance: 2,
  onboardingSuccessRateMin: 0.85,
  onboardingSuccessRateFail: 0.7,
  reactivationRateMaxPerSession: 5,
  reactivationRateFail: 6,
  avgBalanceAtCooldownMaxRatio: 0.15,
  avgBalanceAtCooldownFailRatio: 0.3,
  ldwFrequencyTarget: 0.25,
  ldwFrequencyTolerance: 0.05,
  nearMissFrequencyTarget: 0.15,
  nearMissFrequencyTolerance: 0.05,
  driftCompensationMaxPercent: 2,
  driftCompensationFailPercent: 5,
} as const

/** §12.2: тестовые группы. */
export const AB_GROUPS = [
  {
    name: 'control',
    mechanics: { ldw: false, nearMiss: false, adaptiveRtp: false },
    percentage: 20,
    durationDays: 14,
  },
  {
    name: 'A',
    mechanics: { ldw: true, nearMiss: false, adaptiveRtp: false },
    percentage: 20,
    durationDays: 14,
  },
  {
    name: 'B',
    mechanics: { ldw: false, nearMiss: true, adaptiveRtp: false },
    percentage: 20,
    durationDays: 14,
  },
  {
    name: 'C',
    mechanics: { ldw: true, nearMiss: true, adaptiveRtp: false },
    percentage: 20,
    durationDays: 14,
  },
  {
    name: 'D',
    mechanics: { ldw: true, nearMiss: true, adaptiveRtp: true },
    percentage: 20,
    durationDays: 14,
  },
] as const

/** §12.4: guardrails автоматического откатa. */
export const AB_GUARDRAILS = {
  maxRtpDeviation: 2,
  maxChurnIncrease: 0.1,
  minArpuRatio: 0.95,
  maxComplaintsRate: 0.001,
} as const

/** §12.6 и §10.2: флаги включённости механик. */
export const FEATURE_FLAGS = {
  enabled: true,
  mechanicsEnabled: {
    ldw: true,
    nearMiss: true,
    adaptiveRtp: true,
    cumulativeTracking: true,
  },
  phasesEnabled: {
    onboarding: true,
    retention: true,
    risk: true,
    reactivation: true,
    cooldown: true,
  },
}

/** Строка «0» для инициализации денежных полей. */
export const ZERO: MoneyAmount = '0'
