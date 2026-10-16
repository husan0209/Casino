/**
 * §12.2: что именно включает каждая тестовая группа.
 *
 * Единственный источник правды — `AB_GROUPS` из `src/config.ts`: здесь только
 * вывод типов и доступ по имени группы. Новых чисел и новых механик файл не
 * придумывает: ladder из ТЗ (control → A → B → C → D) повторяется автоматически.
 */
import { AB_GROUPS } from '../config'

/** Имя группы из таблицы §12.2: `control | A | B | C | D`. */
export type ABGroupName = (typeof AB_GROUPS)[number]['name']

/** Механика, которая включается или выключается для группы (§12.2). */
export type ABMechanicName = 'ldw' | 'nearMiss' | 'adaptiveRtp'

/** Набор механик группы. У control все три false — это базовый RTP (§12.2). */
export interface ABGroupMechanics {
  ldw: boolean
  nearMiss: boolean
  adaptiveRtp: boolean
}

/** Строка таблицы §12.2 целиком: механики + размер + длительность теста. */
export interface ABGroupDefinition {
  name: ABGroupName
  mechanics: ABGroupMechanics
  percentage: number
  durationDays: number
}

/** Порядок обхода механик: один и тот же везде, где нужен список. */
export const AB_MECHANIC_NAMES: readonly ABMechanicName[] = ['ldw', 'nearMiss', 'adaptiveRtp']

const GROUP_DEFINITIONS: readonly ABGroupDefinition[] = AB_GROUPS.map(
  (group): ABGroupDefinition => ({
    name: group.name,
    mechanics: {
      ldw: group.mechanics.ldw,
      nearMiss: group.mechanics.nearMiss,
      adaptiveRtp: group.mechanics.adaptiveRtp,
    },
    percentage: group.percentage,
    durationDays: group.durationDays,
  }),
)

const GROUP_DEFINITION_BY_NAME: ReadonlyMap<string, ABGroupDefinition> = new Map(
  GROUP_DEFINITIONS.map((definition): [ABGroupName, ABGroupDefinition] => [
    definition.name,
    definition,
  ]),
)

/** Имена групп в порядке таблицы §12.2: обход для отчётов и симулятора. */
export const AB_GROUP_NAMES: readonly ABGroupName[] = GROUP_DEFINITIONS.map(
  (definition): ABGroupName => definition.name,
)

/** Проверка имени из БД/конфига: §12.6 хранит testGroups как словарь строк. */
export function isABGroupName(value: string): value is ABGroupName {
  return GROUP_DEFINITION_BY_NAME.has(value)
}

/** Полная строка таблицы §12.2: копия, чтобы вызывающий не испортил конфиг. */
export function groupDefinitionOf(group: ABGroupName): ABGroupDefinition {
  const definition = GROUP_DEFINITION_BY_NAME.get(group)
  if (definition === undefined) {
    throw new Error(
      `Неизвестная A/B группа: ${group} (§12.2 объявляет только ${AB_GROUP_NAMES.join(', ')})`,
    )
  }
  return {
    name: definition.name,
    mechanics: {
      ldw: definition.mechanics.ldw,
      nearMiss: definition.mechanics.nearMiss,
      adaptiveRtp: definition.mechanics.adaptiveRtp,
    },
    percentage: definition.percentage,
    durationDays: definition.durationDays,
  }
}

/** Механики группы: ответ на «включены ли ldw / nearMiss / adaptiveRtp». */
export function mechanicsOfGroup(group: ABGroupName): ABGroupMechanics {
  const definition = groupDefinitionOf(group)
  return {
    ldw: definition.mechanics.ldw,
    nearMiss: definition.mechanics.nearMiss,
    adaptiveRtp: definition.mechanics.adaptiveRtp,
  }
}

/** Одна механика одной строкой вызова: оркестратор спрашивает по одной. */
export function isMechanicEnabled(group: ABGroupName, mechanic: ABMechanicName): boolean {
  return mechanicsOfGroup(group)[mechanic]
}

/** Какие механики у группы включены — для заголовка строки отчёта §13.5. */
export function enabledMechanicsOf(group: ABGroupName): ABMechanicName[] {
  const mechanics = mechanicsOfGroup(group)
  return AB_MECHANIC_NAMES.filter((mechanic): boolean => mechanics[mechanic])
}

/**
 * Группа без единой механики = контрольная (§12.2): движок обязан брать
 * baseline-лотерею на заявленном RTP игры, а не engagement-цикл §9.1.
 */
export function isBaselineGroup(group: ABGroupName): boolean {
  return enabledMechanicsOf(group).length === 0
}

/** Доля группы из §12.2: используется распределением, чтобы не дублировать число. */
export function percentageOfGroup(group: ABGroupName): number {
  return groupDefinitionOf(group).percentage
}

/** Длительность теста группы из §12.2: нужна окну flag'а в §12.6. */
export function durationDaysOfGroup(group: ABGroupName): number {
  return groupDefinitionOf(group).durationDays
}
