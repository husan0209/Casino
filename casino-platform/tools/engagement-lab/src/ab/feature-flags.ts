/**
 * §12.6: feature flags engagement engine + §15.1/§15.2 Level 1 откатa.
 *
 * Флаги — чистые данные: в проде они лежат в `system_settings` (§10.3) и
 * обновляются SQL или CLI (§15.2), но лаборатория к БД не обращается и ничего
 * не сохраняет. Здесь только вывод настроек из переданного объекта и чистые
 * функции, возвращающие новые объекты.
 *
 * Чисел здесь нет: доли и длительность групп берутся из `AB_GROUPS`,
 * исходное состояние механик — из `FEATURE_FLAGS` (`src/config.ts`).
 */
import { AB_GROUPS, FEATURE_FLAGS } from '../config'
import {
  type ABGroupMechanics,
  type ABGroupName,
  AB_GROUP_NAMES,
  isABGroupName,
  mechanicsOfGroup,
} from './mechanics'

/** Запись одной тестовой группы в §12.6. */
export interface EngagementTestGroupFlag {
  enabled: boolean
  percentage: number
  startDate: Date
  endDate: Date
}

/** Фазы из §12.6: ровно список ТЗ, COOLDOWN терминальная, DORMANT флагом не управляет. */
export interface EngagementPhasesEnabled {
  onboarding: boolean
  retention: boolean
  risk: boolean
  reactivation: boolean
  cooldown: boolean
}

/** Механики из §12.6: четыре переключателя ТЗ. */
export interface EngagementMechanicsEnabled {
  ldw: boolean
  nearMiss: boolean
  adaptiveRtp: boolean
  cumulativeTracking: boolean
}

/** §12.6: конфигурация через system_settings — тип, а не хранилище. */
export interface EngagementFeatureFlags {
  enabled: boolean
  phasesEnabled: EngagementPhasesEnabled
  mechanicsEnabled: EngagementMechanicsEnabled
  /** Ключ — имя группы; §12.6 объявляет словарь по строке, а не по enum. */
  testGroups: Record<string, EngagementTestGroupFlag>
}

/**
 * Разрешённые настройки группы: механики группы (§12.2) И флаги механик
 * (§12.6) И глобальный on/off с живым окном тестa.
 */
export interface GroupEngagementSettings {
  group: ABGroupName
  /** Глобальный флаг + включённая группа + текущая дата внутри окна. */
  engineEnabled: boolean
  ldw: boolean
  nearMiss: boolean
  adaptiveRtp: boolean
  cumulativeTracking: boolean
  /** §15.2: когда adaptive RTP не работает, новые сессии идут на базовый RTP. */
  useBaselineRtp: boolean
  /** Фазы, разрешённые движку: при выключенном движке все false. */
  phasesEnabled: EngagementPhasesEnabled
}

/** Сутки в миллисекундах: §12.6 не дал календарь, окно считаем от durationDays. */
const MS_PER_DAY = 86_400_000

/** Все механики выключены: базовый объект для `rollbackToBaseline`. */
function disabledMechanics(): EngagementMechanicsEnabled {
  return {
    ldw: false,
    nearMiss: false,
    adaptiveRtp: false,
    cumulativeTracking: false,
  }
}

/** Все фазы выключены: тот же смысл, что в §15.2 «LDW/Near-Miss не применяются». */
function disabledPhases(): EngagementPhasesEnabled {
  return {
    onboarding: false,
    retention: false,
    risk: false,
    reactivation: false,
    cooldown: false,
  }
}

/**
 * Флаги по умолчанию для прогона: состояние механик из `FEATURE_FLAGS`,
 * группы из `AB_GROUPS` (доля + окно durationDays §12.2), старт — переданная
 * дата. Дата параметром, чтобы симуляция и тесты оставались детерминированными.
 */
export function defaultFeatureFlags(now: Date): EngagementFeatureFlags {
  const testGroups: Record<string, EngagementTestGroupFlag> = {}
  for (const group of AB_GROUPS) {
    testGroups[group.name] = {
      enabled: true,
      percentage: group.percentage,
      startDate: now,
      endDate: new Date(now.getTime() + group.durationDays * MS_PER_DAY),
    }
  }

  return {
    enabled: FEATURE_FLAGS.enabled,
    phasesEnabled: {
      onboarding: FEATURE_FLAGS.phasesEnabled.onboarding,
      retention: FEATURE_FLAGS.phasesEnabled.retention,
      risk: FEATURE_FLAGS.phasesEnabled.risk,
      reactivation: FEATURE_FLAGS.phasesEnabled.reactivation,
      cooldown: FEATURE_FLAGS.phasesEnabled.cooldown,
    },
    mechanicsEnabled: {
      ldw: FEATURE_FLAGS.mechanicsEnabled.ldw,
      nearMiss: FEATURE_FLAGS.mechanicsEnabled.nearMiss,
      adaptiveRtp: FEATURE_FLAGS.mechanicsEnabled.adaptiveRtp,
      cumulativeTracking: FEATURE_FLAGS.mechanicsEnabled.cumulativeTracking,
    },
    testGroups,
  }
}

/**
 * Окно группы активно: запись объявлена, включена и дата внутри
 * `[startDate, endDate]`. Отсутствие записи означает «группа не запускалась»
 * (§12.1 принцип 1: пока группа не объявлена, игрок живёт на baseline).
 */
export function isGroupWindowActive(
  flags: EngagementFeatureFlags,
  group: ABGroupName,
  now: Date,
): boolean {
  const entry = flags.testGroups[group]
  if (entry === undefined) {
    return false
  }
  if (entry.enabled === false) {
    return false
  }
  return now.getTime() >= entry.startDate.getTime() && now.getTime() <= entry.endDate.getTime()
}

/**
 * Что включает группа с учётом флагов. `now` параметром, потому что
 * детерминизм лаборатории важнее удобства: вызывающий сам решает, на какой
 * момент смотреть (прогон симуляции, A/A проверка, разбор истории).
 */
export function enabledFor(
  flags: EngagementFeatureFlags,
  group: ABGroupName,
  now: Date = new Date(),
): GroupEngagementSettings {
  const engineEnabled = flags.enabled && isGroupWindowActive(flags, group, now)
  const groupMechanics: ABGroupMechanics = mechanicsOfGroup(group)

  const mechanicsEnabled: EngagementMechanicsEnabled = {
    ldw: engineEnabled && groupMechanics.ldw && flags.mechanicsEnabled.ldw,
    nearMiss: engineEnabled && groupMechanics.nearMiss && flags.mechanicsEnabled.nearMiss,
    adaptiveRtp: engineEnabled && groupMechanics.adaptiveRtp && flags.mechanicsEnabled.adaptiveRtp,
    cumulativeTracking: engineEnabled && flags.mechanicsEnabled.cumulativeTracking,
  }

  return {
    group,
    engineEnabled,
    ldw: mechanicsEnabled.ldw,
    nearMiss: mechanicsEnabled.nearMiss,
    adaptiveRtp: mechanicsEnabled.adaptiveRtp,
    cumulativeTracking: mechanicsEnabled.cumulativeTracking,
    useBaselineRtp: mechanicsEnabled.adaptiveRtp === false,
    phasesEnabled: engineEnabled ? copyPhases(flags.phasesEnabled) : disabledPhases(),
  }
}

/**
 * §15.1 Level 1 / §15.2: мгновенный откат feature flag'ом.
 *
 * Выключается всё: глобальный `enabled`, каждая механика, каждая фаза и каждая
 * запись группы. После этого `enabledFor(...).useBaselineRtp === true` для
 * любой группы, то есть движок обязан использовать базовый RTP игры.
 *
 * Даты и доли групп сохраняются: §15.2 требует «данные сохраняются для
 * анализа», а §15.6 — собрать материал для post-mortem. Входной объект не
 * мутируется: возвращён новый флаг, как это делает SQL UPDATE значениями.
 */
export function rollbackToBaseline(flags: EngagementFeatureFlags): EngagementFeatureFlags {
  const testGroups: Record<string, EngagementTestGroupFlag> = {}
  for (const [groupName, entry] of Object.entries(flags.testGroups)) {
    testGroups[groupName] = {
      enabled: false,
      percentage: entry.percentage,
      startDate: entry.startDate,
      endDate: entry.endDate,
    }
  }

  return {
    enabled: false,
    phasesEnabled: disabledPhases(),
    mechanicsEnabled: disabledMechanics(),
    testGroups,
  }
}

/**
 * Имена групп, у которых окно активно на переданную дату: оркестратору нужно
 * понять, кого вообще касается тест (§12.5: 1 % -> 10 % -> 20 % -> 100 %).
 */
export function activeGroupsOn(flags: EngagementFeatureFlags, now: Date): ABGroupName[] {
  return AB_GROUP_NAMES.filter((group): boolean => isGroupWindowActive(flags, group, now))
}

/** Строка имени -> имя группы: для чтения flags из БД/JSON, где тип стёрт. */
export function requireABGroupName(value: string): ABGroupName {
  if (isABGroupName(value) === false) {
    throw new Error(
      `Неизвестная A/B группа во флагах: ${value} (§12.2: ${AB_GROUP_NAMES.join(', ')})`,
    )
  }
  return value
}

function copyPhases(phases: EngagementPhasesEnabled): EngagementPhasesEnabled {
  return {
    onboarding: phases.onboarding,
    retention: phases.retention,
    risk: phases.risk,
    reactivation: phases.reactivation,
    cooldown: phases.cooldown,
  }
}
