/**
 * ТЗ ч.9 §12 — A/B-эксперимент движка вовлечения.
 *
 * Назначение в группу детерминированное: один и тот же игрок всегда попадает
 * в одну и ту же группу, пока не сменится соль (`ENGAGEMENT_EXPERIMENT_SALT`).
 * Хэш — FNV-1a по строке «соль:назначение:userId»: без криптографии (это не
 * защита, а распределение), зато стабильный между процессами и платформами.
 *
 * Семантика `experimentTrafficShare` (§12.5 «Gradual Rollout»):
 *   0            — эксперимент выключен, движок не работает ни у кого;
 *   0 < share < 1 — в эксперимент попадает доля трафика; внутри неё игроки
 *                   равномерно распределяются по пяти группам §12.2
 *                   (Control / A / B / C / D по 20 %);
 *   share >= 1   — полный роллаут: все игроки идут группой D (полный движок).
 *
 * Группы §12.2 и их механики:
 *   control      — базовый RTP, без манипуляций (все флаги выключены);
 *   ldw          — только LDW;
 *   near_miss    — только Near-Miss;
 *   ldw_near_miss — LDW + Near-Miss без адаптивного RTP;
 *   full         — полный движок (группа D).
 */
import type { EngagementConfig } from './engagement-config'

export type EngagementExperimentGroup = 'control' | 'ldw' | 'near_miss' | 'ldw_near_miss' | 'full'

/** Флаги механик для текущего спина — итог группы и мастер-переключателей оператора. */
export interface EngagementExperimentFlags {
  readonly ldwEnabled: boolean
  readonly nearMissEnabled: boolean
  readonly adaptiveRtpEnabled: boolean
}

export interface EngagementExperimentAssignment {
  /** Игрок попал в эксперимент — движок для него включён. */
  readonly enrolled: boolean
  /** Группа §12.2; null — вне эксперимента (движок работает как выключенный). */
  readonly group: EngagementExperimentGroup | null
  readonly flags: EngagementExperimentFlags
}

/** Порядок групп фиксирован: по нему режутся бакеты 0…9999. */
export const EXPERIMENT_GROUPS: readonly EngagementExperimentGroup[] = [
  'control',
  'ldw',
  'near_miss',
  'ldw_near_miss',
  'full',
]

const BUCKET_COUNT = 10_000

const DISABLED_FLAGS: EngagementExperimentFlags = {
  ldwEnabled: false,
  nearMissEnabled: false,
  adaptiveRtpEnabled: false,
}

/** Механики группы без учёта мастер-переключателей оператора (см. assignExperiment). */
const GROUP_MECHANICS: Record<EngagementExperimentGroup, EngagementExperimentFlags> = {
  control: DISABLED_FLAGS,
  ldw: { ldwEnabled: true, nearMissEnabled: false, adaptiveRtpEnabled: true },
  near_miss: { ldwEnabled: false, nearMissEnabled: true, adaptiveRtpEnabled: true },
  ldw_near_miss: { ldwEnabled: true, nearMissEnabled: true, adaptiveRtpEnabled: false },
  full: { ldwEnabled: true, nearMissEnabled: true, adaptiveRtpEnabled: true },
}

/** FNV-1a (32 бита) — детерминированный и дешёвый хэш для раскладки по бакетам. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    // Умножение на 16777619 через сдвиги, чтобы остаться в 32-битном диапазоне.
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Бакет 0…9999 для произвольной строки. */
export function bucketOf(input: string): number {
  return fnv1a(input) % BUCKET_COUNT
}

/**
 * §12 — назначение игрока. Внутри группы механики дополнительно сужаются
 * мастер-переключателями оператора (`ENGAGEMENT_LDW_ENABLED` и т.п.):
 * отключённая оператором механика молчит во всех группах.
 */
export function assignExperiment(
  userId: string,
  config: EngagementConfig,
): EngagementExperimentAssignment {
  const share = Math.min(Math.max(config.experimentTrafficShare, 0), 1)
  if (share <= 0) {
    return { enrolled: false, group: null, flags: DISABLED_FLAGS }
  }
  if (share >= 1) {
    return { enrolled: true, group: 'full', flags: combineWithOperatorFlags('full', config) }
  }

  const rolloutBucket = bucketOf(`${config.experimentSalt}:rollout:${userId}`)
  if (rolloutBucket >= Math.round(share * BUCKET_COUNT)) {
    return { enrolled: false, group: null, flags: DISABLED_FLAGS }
  }

  const groupBucket = bucketOf(`${config.experimentSalt}:group:${userId}`)
  const span = Math.floor(BUCKET_COUNT / EXPERIMENT_GROUPS.length)
  const index = Math.min(EXPERIMENT_GROUPS.length - 1, Math.floor(groupBucket / span))
  // Индекс нормализован и всегда внутри массива; `?? 'control'` — только для типов.
  const group = EXPERIMENT_GROUPS[index] ?? 'control'

  return { enrolled: true, group, flags: combineWithOperatorFlags(group, config) }
}

function combineWithOperatorFlags(
  group: EngagementExperimentGroup,
  config: EngagementConfig,
): EngagementExperimentFlags {
  const mechanics = GROUP_MECHANICS[group]
  return {
    ldwEnabled: mechanics.ldwEnabled && config.ldwEnabled,
    nearMissEnabled: mechanics.nearMissEnabled && config.nearMissEnabled,
    adaptiveRtpEnabled: mechanics.adaptiveRtpEnabled,
  }
}
