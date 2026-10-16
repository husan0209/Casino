/**
 * Тесты блока A/B (§12.1, §12.2, §12.4, §12.6, §15.1/§15.2).
 *
 * Метрики retention/LTV из §12.3 здесь не считаются — это задача блока
 * симуляции; тут проверяется контракт: чем именно группа управляет, как
 * игрок в неё попадает и когда guardrails требуют откат.
 */
import { describe, expect, it } from 'vitest'

import {
  assignGroup,
  assignGroupWithSplit,
  bucketOf,
  countByGroup,
  countBySegment,
  expectedShareOf,
  PLAYER_SEGMENTS,
  shareByGroup,
  type ABAssignment,
  type ABGroupSplitSlice,
  type PlayerSegment,
} from '../src/ab/assignment'
import {
  activeGroupsOn,
  defaultFeatureFlags,
  enabledFor,
  isGroupWindowActive,
  requireABGroupName,
  rollbackToBaseline,
  type EngagementFeatureFlags,
  type EngagementMechanicsEnabled,
  type EngagementTestGroupFlag,
} from '../src/ab/feature-flags'
import {
  checkGuardrails,
  DEFAULT_AB_GUARDRAILS,
  guardrailViolations,
  type ABTestMetrics,
} from '../src/ab/guardrails'
import {
  AB_GROUP_NAMES,
  durationDaysOfGroup,
  enabledMechanicsOf,
  groupDefinitionOf,
  isABGroupName,
  isBaselineGroup,
  isMechanicEnabled,
  mechanicsOfGroup,
  percentageOfGroup,
  type ABGroupMechanics,
  type ABGroupName,
} from '../src/ab/mechanics'
import { AB_GROUPS, AB_GUARDRAILS } from '../src/config'

const START_DATE = new Date('2026-10-15T00:00:00.000Z')
const WITHIN_WINDOW_DATE = new Date('2026-10-20T00:00:00.000Z')
const AFTER_WINDOW_DATE = new Date('2026-11-05T00:00:00.000Z')

/** Ожидаемая лестница механик из таблицы §12.2. */
const EXPECTED_MECHANICS: Record<ABGroupName, ABGroupMechanics> = {
  control: { ldw: false, nearMiss: false, adaptiveRtp: false },
  A: { ldw: true, nearMiss: false, adaptiveRtp: false },
  B: { ldw: false, nearMiss: true, adaptiveRtp: false },
  C: { ldw: true, nearMiss: true, adaptiveRtp: false },
  D: { ldw: true, nearMiss: true, adaptiveRtp: true },
}

/** Метрики control-уровня: всё в пределах guardrails §12.4. */
const SAFE_METRICS: ABTestMetrics = {
  rtpDeviation: 0.5,
  churnRate: 0.2,
  controlChurnRate: 0.2,
  arpu: 100,
  controlArpu: 100,
  complaintsRate: 0.0005,
}

/** Допуск долей на 1000 игроков: 3 сигма биномиального разброса ~3.8 %. */
const SHARE_TOLERANCE = 0.05

function usersOfSegment(segment: PlayerSegment, count: number): ABAssignment[] {
  const assignments: ABAssignment[] = []
  for (let index = 0; index < count; index++) {
    assignments.push(assignGroup(`player-${index}`, segment))
  }
  return assignments
}

function withMechanics(
  flags: EngagementFeatureFlags,
  patch: Partial<EngagementMechanicsEnabled>,
): EngagementFeatureFlags {
  return {
    enabled: flags.enabled,
    phasesEnabled: flags.phasesEnabled,
    mechanicsEnabled: { ...flags.mechanicsEnabled, ...patch },
    testGroups: flags.testGroups,
  }
}

function withGlobalFlag(flags: EngagementFeatureFlags, enabled: boolean): EngagementFeatureFlags {
  return {
    enabled,
    phasesEnabled: flags.phasesEnabled,
    mechanicsEnabled: flags.mechanicsEnabled,
    testGroups: flags.testGroups,
  }
}

function withGroupFlag(
  flags: EngagementFeatureFlags,
  group: ABGroupName,
  patch: Partial<EngagementTestGroupFlag>,
): EngagementFeatureFlags {
  const entry = flags.testGroups[group]
  if (entry === undefined) {
    throw new Error(`В флагах нет записи группы ${group}`)
  }
  return {
    ...flags,
    testGroups: { ...flags.testGroups, [group]: { ...entry, ...patch } },
  }
}

function withoutGroupFlags(
  flags: EngagementFeatureFlags,
  group: ABGroupName,
): EngagementFeatureFlags {
  const testGroups: Record<string, EngagementTestGroupFlag> = { ...flags.testGroups }
  delete testGroups[group]
  return { ...flags, testGroups }
}

describe('§12.2 тестовые группы', () => {
  it('групп ровно пять и их имена соответствуют таблице ТЗ', (): void => {
    expect(AB_GROUP_NAMES).toEqual(['control', 'A', 'B', 'C', 'D'])
    expect(AB_GROUPS).toHaveLength(5)
  })

  it('каждая группа занимает 20 % и тест длится 14 дней', (): void => {
    for (const group of AB_GROUP_NAMES) {
      expect(percentageOfGroup(group)).toBe(20)
      expect(durationDaysOfGroup(group)).toBe(14)
      expect(groupDefinitionOf(group).percentage).toBe(20)
    }
    const totalPercentage = AB_GROUP_NAMES.reduce(
      (sum, group): number => sum + percentageOfGroup(group),
      0,
    )
    expect(totalPercentage).toBe(100)
  })

  it('лестница механик control -> A -> B -> C -> D повторяет таблицу', (): void => {
    for (const group of AB_GROUP_NAMES) {
      expect(mechanicsOfGroup(group)).toEqual(EXPECTED_MECHANICS[group])
    }
    expect(enabledMechanicsOf('control')).toEqual([])
    expect(enabledMechanicsOf('A')).toEqual(['ldw'])
    expect(enabledMechanicsOf('B')).toEqual(['nearMiss'])
    expect(enabledMechanicsOf('C')).toEqual(['ldw', 'nearMiss'])
    expect(enabledMechanicsOf('D')).toEqual(['ldw', 'nearMiss', 'adaptiveRtp'])
  })

  it('ответ про одну механику совпадает с ответом про весь набор', (): void => {
    for (const group of AB_GROUP_NAMES) {
      for (const mechanic of ['ldw', 'nearMiss', 'adaptiveRtp'] as const) {
        expect(isMechanicEnabled(group, mechanic)).toBe(EXPECTED_MECHANICS[group][mechanic])
      }
    }
  })

  it('baseline-движок нужен только контрольной группе', (): void => {
    expect(isBaselineGroup('control')).toBe(true)
    for (const group of ['A', 'B', 'C', 'D'] as const) {
      expect(isBaselineGroup(group)).toBe(false)
    }
  })

  it('чужое имя группы не проходит проверку и не ломает словарь', (): void => {
    expect(isABGroupName('control')).toBe(true)
    expect(isABGroupName('E')).toBe(false)
    expect(isABGroupName('')).toBe(false)
  })
})

describe('§12.1 стратифицированное детерминированное распределение', () => {
  it('один и тот же userId + сегмент попадает в одну группу всегда', (): void => {
    for (const segment of PLAYER_SEGMENTS) {
      for (let index = 0; index < 200; index++) {
        const userId = `player-${index}`
        const first = assignGroup(userId, segment)
        const second = assignGroup(userId, segment)
        expect(second.group).toBe(first.group)
        expect(second.bucket).toBe(first.bucket)
        expect(first.bucket).toBe(bucketOf(userId, segment))
        expect(first.userId).toBe(userId)
        expect(first.segment).toBe(segment)
      }
    }
  })

  it('распределение не зависит от порядка обхода выборки', (): void => {
    const collected: ABAssignment[] = usersOfSegment('regular', 300)
    const recomputed = new Map<string, ABGroupName>()
    for (let index = collected.length - 1; index >= 0; index--) {
      const assignment = collected[index] as ABAssignment
      recomputed.set(assignment.userId, assignGroup(assignment.userId, assignment.segment).group)
    }

    expect(recomputed.size).toBe(collected.length)
    for (const assignment of collected) {
      expect(recomputed.get(assignment.userId)).toBe(assignment.group)
    }
  })

  it('1000 разных игроков каждого сегмента делятся на пять групп по 20 %', (): void => {
    for (const segment of PLAYER_SEGMENTS) {
      const assignments = usersOfSegment(segment, 1000)
      const shares = shareByGroup(assignments)
      const counts = countByGroup(assignments)
      expect(countBySegment(assignments)[segment]).toBe(1000)

      for (const group of AB_GROUP_NAMES) {
        expect(counts[group]).toBeGreaterThan(0)
        expect(Math.abs(shares[group] - expectedShareOf(group))).toBeLessThan(SHARE_TOLERANCE)
      }
    }
  })

  it('доли совпадают и на смешанной выборке из трёх сегментов', (): void => {
    const mixed: ABAssignment[] = []
    for (const segment of PLAYER_SEGMENTS) {
      mixed.push(...usersOfSegment(segment, 500))
    }
    const shares = shareByGroup(mixed)
    for (const group of AB_GROUP_NAMES) {
      expect(Math.abs(shares[group] - expectedShareOf(group))).toBeLessThan(SHARE_TOLERANCE)
    }
  })

  it('корзины лежат в диапазоне 0..99 и покрывают его целиком', (): void => {
    const assignments = usersOfSegment('vip', 2000)
    const buckets = new Set<number>()
    for (const assignment of assignments) {
      expect(assignment.bucket).toBeGreaterThanOrEqual(0)
      expect(assignment.bucket).toBeLessThan(100)
      buckets.add(assignment.bucket)
    }
    expect(buckets.size).toBe(100)
  })

  it('явный сплит §15.3 меняет доли, оставаясь детерминированным', (): void => {
    const gradualSplit: ABGroupSplitSlice[] = [
      { group: 'control', percentage: 40 },
      { group: 'A', percentage: 20 },
      { group: 'B', percentage: 20 },
      { group: 'C', percentage: 15 },
      { group: 'D', percentage: 5 },
    ]
    const assignments: ABAssignment[] = []
    for (let index = 0; index < 2000; index++) {
      assignments.push(assignGroupWithSplit(`player-${index}`, 'newcomer', gradualSplit))
    }
    const shares = shareByGroup(assignments)
    expect(Math.abs(shares.control - 0.4)).toBeLessThan(SHARE_TOLERANCE)
    expect(Math.abs(shares.D - 0.05)).toBeLessThan(SHARE_TOLERANCE)
    expect(assignGroupWithSplit('player-1', 'newcomer', gradualSplit).group).toBe(
      assignGroupWithSplit('player-1', 'newcomer', gradualSplit).group,
    )
  })

  it('сплит без 100 % суммы и дубль группы падают с внятной ошибкой', (): void => {
    const brokenSplit: ABGroupSplitSlice[] = [
      { group: 'control', percentage: 30 },
      { group: 'A', percentage: 30 },
    ]
    expect(() => assignGroupWithSplit('player-1', 'regular', brokenSplit)).toThrow(/100/)

    const duplicateSplit: ABGroupSplitSlice[] = [
      { group: 'control', percentage: 50 },
      { group: 'control', percentage: 50 },
    ]
    expect(() => assignGroupWithSplit('player-1', 'regular', duplicateSplit)).toThrow(/дважды/)

    const emptySplit: ABGroupSplitSlice[] = []
    expect(() => assignGroupWithSplit('player-1', 'regular', emptySplit)).toThrow(/пустой сплит/)
  })
})

describe('§12.4 guardrails', () => {
  it('пороги берутся из AB_GUARDRAILS, а не из головы', (): void => {
    expect(DEFAULT_AB_GUARDRAILS).toEqual({
      maxRtpDeviation: AB_GUARDRAILS.maxRtpDeviation,
      maxChurnIncrease: AB_GUARDRAILS.maxChurnIncrease,
      minArpuRatio: AB_GUARDRAILS.minArpuRatio,
      maxComplaintsRate: AB_GUARDRAILS.maxComplaintsRate,
    })
  })

  it('полностью корректные метрики безопасны и без причины', (): void => {
    expect(checkGuardrails('D', SAFE_METRICS, DEFAULT_AB_GUARDRAILS)).toEqual({ safe: true })
  })

  it('отклонение RTP ровно на пороге безопасно, 2.01 — уже нет', (): void => {
    expect(
      checkGuardrails('D', { ...SAFE_METRICS, rtpDeviation: 2 }, DEFAULT_AB_GUARDRAILS),
    ).toEqual({ safe: true })
    expect(
      checkGuardrails('D', { ...SAFE_METRICS, rtpDeviation: 2.01 }, DEFAULT_AB_GUARDRAILS),
    ).toEqual({ safe: false, reason: 'RTP deviation too high: 2.01%' })
  })

  it('модуль отклонения RTP: минус 2 безопасно, минус 2.01 требует откат', (): void => {
    expect(
      checkGuardrails('C', { ...SAFE_METRICS, rtpDeviation: -2 }, DEFAULT_AB_GUARDRAILS),
    ).toEqual({ safe: true })
    const verdict = checkGuardrails(
      'C',
      { ...SAFE_METRICS, rtpDeviation: -2.01 },
      DEFAULT_AB_GUARDRAILS,
    )
    expect(verdict.safe).toBe(false)
    expect(verdict.reason).toContain('RTP deviation too high')
  })

  it('churn на +10 % к control безопасен, +11 % требует откат', (): void => {
    const controlChurnRate = SAFE_METRICS.controlChurnRate
    const boundaryChurnRate = controlChurnRate * (1 + AB_GUARDRAILS.maxChurnIncrease)
    expect(
      checkGuardrails(
        'A',
        { ...SAFE_METRICS, churnRate: boundaryChurnRate },
        DEFAULT_AB_GUARDRAILS,
      ),
    ).toEqual({ safe: true })

    const violation = checkGuardrails(
      'A',
      {
        ...SAFE_METRICS,
        churnRate: controlChurnRate * (1 + AB_GUARDRAILS.maxChurnIncrease) + 0.01,
      },
      DEFAULT_AB_GUARDRAILS,
    )
    expect(violation.safe).toBe(false)
    expect(violation.reason).toContain('Churn rate increased')
  })

  it('ARPU на 0.95 от control безопасен, 0.94 — откат', (): void => {
    const controlArpu = SAFE_METRICS.controlArpu
    expect(
      checkGuardrails(
        'B',
        { ...SAFE_METRICS, arpu: controlArpu * AB_GUARDRAILS.minArpuRatio },
        DEFAULT_AB_GUARDRAILS,
      ),
    ).toEqual({ safe: true })

    const violation = checkGuardrails(
      'B',
      { ...SAFE_METRICS, arpu: controlArpu * AB_GUARDRAILS.minArpuRatio - 1 },
      DEFAULT_AB_GUARDRAILS,
    )
    expect(violation.safe).toBe(false)
    expect(violation.reason).toContain('ARPU dropped')
  })

  it('жалобы ровно 0.1 % безопасны, выше — откат', (): void => {
    expect(
      checkGuardrails(
        'D',
        { ...SAFE_METRICS, complaintsRate: AB_GUARDRAILS.maxComplaintsRate },
        DEFAULT_AB_GUARDRAILS,
      ),
    ).toEqual({ safe: true })

    const violation = checkGuardrails(
      'D',
      { ...SAFE_METRICS, complaintsRate: AB_GUARDRAILS.maxComplaintsRate + 0.001 },
      DEFAULT_AB_GUARDRAILS,
    )
    expect(violation.safe).toBe(false)
    expect(violation.reason).toContain('Complaints rate too high')
  })

  it('битая метрика не превращается в безопасный вердикт', (): void => {
    const violation = checkGuardrails(
      'D',
      { ...SAFE_METRICS, churnRate: Number.NaN },
      DEFAULT_AB_GUARDRAILS,
    )
    expect(violation.safe).toBe(false)
    expect(violation.reason).toContain('churnRate')
    expect(
      guardrailViolations('D', { ...SAFE_METRICS, arpu: Number.POSITIVE_INFINITY })[0]?.code,
    ).toBe('INVALID_METRICS')
  })

  it('список нарушений идёт в порядке §12.4 и атрибутирует группу', (): void => {
    const brokenMetrics: ABTestMetrics = {
      rtpDeviation: 5,
      churnRate: 0.5,
      controlChurnRate: 0.2,
      arpu: 50,
      controlArpu: 100,
      complaintsRate: 0.02,
    }
    const violations = guardrailViolations('D', brokenMetrics, DEFAULT_AB_GUARDRAILS)
    expect(violations.map((violation): string => violation.code)).toEqual([
      'RTP_DEVIATION',
      'CHURN_INCREASE',
      'ARPU_DROP',
      'COMPLAINTS_RATE',
    ])
    for (const violation of violations) {
      expect(violation.group).toBe('D')
    }
    expect(checkGuardrails('D', brokenMetrics, DEFAULT_AB_GUARDRAILS).reason).toBe(
      violations[0]?.reason,
    )
  })
})

describe('§12.6 feature flags и §15.1 Level 1 откат', () => {
  it('флаги по умолчанию объявляют все пять групп с окном 14 дней', (): void => {
    const flags = defaultFeatureFlags(START_DATE)
    expect(flags.enabled).toBe(true)
    expect(activeGroupsOn(flags, WITHIN_WINDOW_DATE)).toEqual([...AB_GROUP_NAMES])

    for (const group of AB_GROUP_NAMES) {
      const entry = flags.testGroups[group]
      expect(entry?.percentage).toBe(percentageOfGroup(group))
      expect(entry?.enabled).toBe(true)
      expect(entry?.startDate).toEqual(START_DATE)
      expect(entry?.endDate).toEqual(new Date(START_DATE.getTime() + 14 * 86_400_000))
    }
  })

  it('настройки группы = механики §12.2 И флаги §12.6', (): void => {
    const flags = defaultFeatureFlags(START_DATE)
    for (const group of AB_GROUP_NAMES) {
      const settings = enabledFor(flags, group, WITHIN_WINDOW_DATE)
      expect(settings.group).toBe(group)
      expect(settings.engineEnabled).toBe(true)
      expect({
        ldw: settings.ldw,
        nearMiss: settings.nearMiss,
        adaptiveRtp: settings.adaptiveRtp,
      }).toEqual(EXPECTED_MECHANICS[group])
      expect(settings.useBaselineRtp).toBe(EXPECTED_MECHANICS[group].adaptiveRtp === false)
      expect(settings.phasesEnabled).toEqual(flags.phasesEnabled)
    }
  })

  it('выключенная механика флагом гасит её во всех группах', (): void => {
    const flags = withMechanics(defaultFeatureFlags(START_DATE), { ldw: false })
    expect(enabledFor(flags, 'A', WITHIN_WINDOW_DATE).ldw).toBe(false)
    expect(enabledFor(flags, 'C', WITHIN_WINDOW_DATE).ldw).toBe(false)
    expect(enabledFor(flags, 'D', WITHIN_WINDOW_DATE).ldw).toBe(false)
    expect(enabledFor(flags, 'C', WITHIN_WINDOW_DATE).nearMiss).toBe(true)
  })

  it('группа вне окна или выключенная не двигает движок (§12.5 rollout)', (): void => {
    const flags = defaultFeatureFlags(START_DATE)
    expect(isGroupWindowActive(flags, 'D', WITHIN_WINDOW_DATE)).toBe(true)
    expect(isGroupWindowActive(flags, 'D', AFTER_WINDOW_DATE)).toBe(false)
    expect(isGroupWindowActive(flags, 'D', new Date(START_DATE.getTime() - 1000))).toBe(false)

    const expiredSettings = enabledFor(flags, 'D', AFTER_WINDOW_DATE)
    expect(expiredSettings.engineEnabled).toBe(false)
    expect(expiredSettings.adaptiveRtp).toBe(false)
    expect(expiredSettings.useBaselineRtp).toBe(true)
    expect(expiredSettings.phasesEnabled).toEqual({
      onboarding: false,
      retention: false,
      risk: false,
      reactivation: false,
      cooldown: false,
    })
    expect(activeGroupsOn(flags, AFTER_WINDOW_DATE)).toEqual([])

    const stoppedFlags = withGroupFlag(flags, 'D', { enabled: false })
    expect(enabledFor(stoppedFlags, 'D', WITHIN_WINDOW_DATE).engineEnabled).toBe(false)
    expect(enabledFor(stoppedFlags, 'C', WITHIN_WINDOW_DATE).engineEnabled).toBe(true)
  })

  it('отсутствие записи группы означает baseline, а не «включено по умолчанию»', (): void => {
    const unstartedGroups = AB_GROUP_NAMES.filter((group): boolean => group !== 'control')
    const flagsOnlyControl = unstartedGroups.reduce(
      (accumulator, group): EngagementFeatureFlags => withoutGroupFlags(accumulator, group),
      defaultFeatureFlags(START_DATE),
    )
    const settings = enabledFor(flagsOnlyControl, 'D', WITHIN_WINDOW_DATE)
    expect(settings.engineEnabled).toBe(false)
    expect(settings.useBaselineRtp).toBe(true)
    expect(isGroupWindowActive(flagsOnlyControl, 'A', WITHIN_WINDOW_DATE)).toBe(false)
    expect(enabledFor(flagsOnlyControl, 'control', WITHIN_WINDOW_DATE).engineEnabled).toBe(true)
  })

  it('глобальный off (§15.2) выключает всё, группа остаётся в данных', (): void => {
    const flags = withGlobalFlag(defaultFeatureFlags(START_DATE), false)
    const settings = enabledFor(flags, 'D', WITHIN_WINDOW_DATE)
    expect(settings.engineEnabled).toBe(false)
    expect(settings.ldw).toBe(false)
    expect(settings.nearMiss).toBe(false)
    expect(settings.adaptiveRtp).toBe(false)
    expect(settings.useBaselineRtp).toBe(true)
    expect(flags.testGroups.D?.enabled).toBe(true)
  })

  it('rollbackToBaseline (§15.1 Level 1) гасит механики, фазы и группы', (): void => {
    const flags = defaultFeatureFlags(START_DATE)
    const rolledBack = rollbackToBaseline(flags)

    expect(rolledBack.enabled).toBe(false)
    expect(rolledBack.mechanicsEnabled).toEqual({
      ldw: false,
      nearMiss: false,
      adaptiveRtp: false,
      cumulativeTracking: false,
    })
    expect(rolledBack.phasesEnabled).toEqual({
      onboarding: false,
      retention: false,
      risk: false,
      reactivation: false,
      cooldown: false,
    })
    for (const group of AB_GROUP_NAMES) {
      expect(rolledBack.testGroups[group]?.enabled).toBe(false)
      expect(rolledBack.testGroups[group]?.percentage).toBe(percentageOfGroup(group))
      expect(rolledBack.testGroups[group]?.startDate).toEqual(START_DATE)
    }

    for (const group of AB_GROUP_NAMES) {
      const settings = enabledFor(rolledBack, group, WITHIN_WINDOW_DATE)
      expect(settings.engineEnabled).toBe(false)
      expect(settings.ldw).toBe(false)
      expect(settings.nearMiss).toBe(false)
      expect(settings.adaptiveRtp).toBe(false)
      expect(settings.cumulativeTracking).toBe(false)
      expect(settings.useBaselineRtp).toBe(true)
    }
  })

  it('rollback не мутирует вход и идемпотентен', (): void => {
    const flags = defaultFeatureFlags(START_DATE)
    const snapshot: EngagementFeatureFlags = {
      enabled: flags.enabled,
      phasesEnabled: { ...flags.phasesEnabled },
      mechanicsEnabled: { ...flags.mechanicsEnabled },
      testGroups: { ...flags.testGroups },
    }
    const first = rollbackToBaseline(flags)
    const second = rollbackToBaseline(first)

    expect(flags).toEqual(snapshot)
    expect(first.mechanicsEnabled).toEqual(second.mechanicsEnabled)
    expect(first.enabled).toBe(second.enabled)
    expect(second.testGroups.D?.endDate).toEqual(first.testGroups.D?.endDate)
  })

  it('имя группы из БД проходит проверку и остаётся строкой', (): void => {
    expect(requireABGroupName('C')).toBe('C')
    expect(() => requireABGroupName('E')).toThrow(/Неизвестная A\/B группа/)
  })
})
