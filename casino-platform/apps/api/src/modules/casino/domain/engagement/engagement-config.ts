/**
 * ТЗ ч.9 — конфигурация движка вовлечения.
 *
 * Все числа §4–§8 живут здесь и только здесь: и use-cases, и тесты, и
 * симулятор (tools/engagement-lab) читают их из одного места. Значения
 * по умолчанию — дословно из ТЗ; env-переопределения нужны для оператора,
 * который хочет сузить поведение без правки кода.
 *
 * Важно: `enabled` по умолчанию false. Движок меняет RTP спина и дописывает
 * кредит игроку, поэтому включать его — осознанное действие оператора
 * (переменная ENGAGEMENT_ENABLED в окружении), а не поведение при старте.
 */
import type { EngagementPhase } from './engagement-phase'

export interface EngagementConfig {
  /** Мастер-выключатель. false → движок не трогает спин вообще. */
  readonly enabled: boolean
  /** §5.2 — порог спинов, после которого ONBOARDING отпускает игрока. */
  readonly onboardingSpinThreshold: number
  /** §5.2 — баланс ≥ 125 % депозита тоже завершает ONBOARDING. */
  readonly onboardingBalanceTargetRatio: number
  /** §4.2 — максимум реактиваций за сессию (0 = реактивации выключены). */
  readonly maxReactivations: number
  /** §4.3 — пауза в спинах между реактивациями; до первой реактивации не действует. */
  readonly minSpinsBetweenReactivations: number
  /** §4.2/§4.3 — коридор возврата баланса при реактивации, доля депозита. */
  readonly reactivationTargetMinRatio: number
  readonly reactivationTargetMaxRatio: number
  /** §5.2 — сколько спинов реактивации удерживает фазу до возврата в RETENTION. */
  readonly reactivationPhaseMinSpins: number
  /** §7.1 — глобальная отсечка RTP (проценты). */
  readonly rtpMinPercent: number
  readonly rtpMaxPercent: number
  /** §7.3 — максимум изменения RTP за один спин, п.п. */
  readonly maxRtpChangePerSpin: number
  /** §7.1 — порог дрейфа, ниже которого компенсация считается шумом. */
  readonly driftNoiseThreshold: number
  /** §8.1 — окно выплаты LDW как доля ставки. */
  readonly ldwMinPayoutRatio: number
  readonly ldwMaxPayoutRatio: number
  /** §8.1/§8.2 — амплитуда dithering к частоте механик. */
  readonly ditherRange: number
  readonly ldwEnabled: boolean
  readonly nearMissEnabled: boolean
  /** §6.4 — TTL кэша Score в Redis, секунды. */
  readonly scoreCacheTtlSeconds: number
  /** §12.2 — соль детерминированного назначения A/B-группы. */
  readonly experimentSalt: string
  /**
   * §12.5 — доля трафика в эксперименте (gradual rollout): 0 — эксперимент
   * выключен, 0…1 — сплит на пять групп §12.2 внутри доли, 1 — полный
   * роллаут (все игроки в группе D, движения по группам нет).
   */
  readonly experimentTrafficShare: number
}

export const DEFAULT_ENGAGEMENT_CONFIG: EngagementConfig = {
  enabled: false,
  onboardingSpinThreshold: 15,
  onboardingBalanceTargetRatio: 1.25,
  maxReactivations: 4,
  minSpinsBetweenReactivations: 10,
  reactivationTargetMinRatio: 0.7,
  reactivationTargetMaxRatio: 0.8,
  reactivationPhaseMinSpins: 3,
  rtpMinPercent: 90,
  rtpMaxPercent: 110,
  maxRtpChangePerSpin: 2,
  driftNoiseThreshold: 2,
  ldwMinPayoutRatio: 0.3,
  ldwMaxPayoutRatio: 0.6,
  ditherRange: 0.05,
  ldwEnabled: true,
  nearMissEnabled: true,
  scoreCacheTtlSeconds: 300,
  experimentSalt: 'engagement-v1',
  // Полный роллаут по умолчанию: A/B-сплит включается осознанным понижением
  // доли (§12.5: 1 % → 10 % → 20 %), а не «сам» при включении движка.
  experimentTrafficShare: 1,
}

/** §7.2 — целевой RTP по фазам (проценты). */
export const RTP_RANGES: Record<EngagementPhase, { min: number; max: number }> = {
  onboarding: { min: 105, max: 110 },
  retention: { min: 94, max: 98 },
  risk: { min: 98, max: 102 },
  reactivation: { min: 103, max: 108 },
  cooldown: { min: 96, max: 96 },
  dormant: { min: 96, max: 96 },
}

/** §5.3/§8.1 — частота LDW по фазам. */
export const LDW_FREQUENCY: Record<EngagementPhase, number> = {
  onboarding: 0.15,
  retention: 0.25,
  risk: 0.3,
  reactivation: 0.2,
  cooldown: 0,
  dormant: 0,
}

/** §8.2 — частота Near-Miss по фазам. */
export const NEAR_MISS_FREQUENCY: Record<EngagementPhase, number> = {
  onboarding: 0.1,
  retention: 0.15,
  risk: 0.2,
  reactivation: 0.25,
  cooldown: 0,
  dormant: 0,
}

/** §5.2 — пороги цикла баланса как доли депозита. */
export const BALANCE_THRESHOLDS = {
  /** §5.2 RISK: баланс ниже половины депозита + признаки ухода. */
  riskRatio: 0.5,
  /** §5.2 RISK → REACTIVATION: критическая точка. */
  reactivationRatio: 0.2,
  /** §4.3 — возврат из REACTIVATION в RETENTION. */
  recoveryRatio: 0.7,
  /** §5.2 — признак «почти ушёл» для Score. */
  nearZeroRatio: 0.1,
  /** §6.2 — медленные клики: меньше N спинов за 5 минут. */
  slowClickingSpinsIn5Min: 15,
  /** §6.2 — быстрые клики: больше N спинов за минуту. */
  rapidClickingSpinsPerMin: 10,
  /** §6.2 — пауза после проигрыша, мс. */
  longPauseAfterLossMs: 30_000,
  /** §6.2 — «просел интерес»: средний интервал между спинами, мс. */
  slowAvgIntervalMs: 15_000,
  /**
   * §5.2 — окно неактивности, после которого игрок считается отсутствующим.
   * Внутри окна тишина — это «пауза» (сигнал удержания), за окном — игрок ушёл,
   * и поощрять его за RTP нельзя: это уже не поведение, а простой.
   */
  inactivityMs: 30 * 60 * 1000,
} as const

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback
  }
  return value === 'true' || value === '1'
}

/**
 * Собирает конфиг из окружения поверх значений по умолчанию.
 * Значение по умолчанию для `enabled` — false: движок меняет RTP спина,
 * пока его не включат явно.
 */
export function resolveEngagementConfig(env: NodeJS.ProcessEnv = process.env): EngagementConfig {
  const defaults = DEFAULT_ENGAGEMENT_CONFIG
  return {
    enabled: bool(env.ENGAGEMENT_ENABLED, defaults.enabled),
    onboardingSpinThreshold: num(
      env.ENGAGEMENT_ONBOARDING_SPIN_THRESHOLD,
      defaults.onboardingSpinThreshold,
    ),
    onboardingBalanceTargetRatio: num(
      env.ENGAGEMENT_ONBOARDING_TARGET_RATIO,
      defaults.onboardingBalanceTargetRatio,
    ),
    maxReactivations: num(env.ENGAGEMENT_MAX_REACTIVATIONS, defaults.maxReactivations),
    minSpinsBetweenReactivations: num(
      env.ENGAGEMENT_MIN_SPINS_BETWEEN_REACTIVATIONS,
      defaults.minSpinsBetweenReactivations,
    ),
    reactivationTargetMinRatio: num(
      env.ENGAGEMENT_REACTIVATION_TARGET_MIN,
      defaults.reactivationTargetMinRatio,
    ),
    reactivationTargetMaxRatio: num(
      env.ENGAGEMENT_REACTIVATION_TARGET_MAX,
      defaults.reactivationTargetMaxRatio,
    ),
    reactivationPhaseMinSpins: num(
      env.ENGAGEMENT_REACTIVATION_PHASE_SPINS,
      defaults.reactivationPhaseMinSpins,
    ),
    rtpMinPercent: num(env.ENGAGEMENT_RTP_MIN, defaults.rtpMinPercent),
    rtpMaxPercent: num(env.ENGAGEMENT_RTP_MAX, defaults.rtpMaxPercent),
    maxRtpChangePerSpin: num(env.ENGAGEMENT_MAX_RTP_CHANGE, defaults.maxRtpChangePerSpin),
    driftNoiseThreshold: num(env.ENGAGEMENT_DRIFT_THRESHOLD, defaults.driftNoiseThreshold),
    ldwMinPayoutRatio: num(env.ENGAGEMENT_LDW_MIN_RATIO, defaults.ldwMinPayoutRatio),
    ldwMaxPayoutRatio: num(env.ENGAGEMENT_LDW_MAX_RATIO, defaults.ldwMaxPayoutRatio),
    ditherRange: num(env.ENGAGEMENT_DITHER, defaults.ditherRange),
    ldwEnabled: bool(env.ENGAGEMENT_LDW_ENABLED, defaults.ldwEnabled),
    nearMissEnabled: bool(env.ENGAGEMENT_NEAR_MISS_ENABLED, defaults.nearMissEnabled),
    scoreCacheTtlSeconds: num(env.ENGAGEMENT_SCORE_TTL_SECONDS, defaults.scoreCacheTtlSeconds),
    experimentSalt: env.ENGAGEMENT_EXPERIMENT_SALT ?? defaults.experimentSalt,
    experimentTrafficShare: num(
      env.ENGAGEMENT_EXPERIMENT_TRAFFIC_SHARE,
      defaults.experimentTrafficShare,
    ),
  }
}
