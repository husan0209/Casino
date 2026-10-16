import { describe, expect, it } from 'vitest'

import { DEFAULT_ENGAGEMENT_CONFIG } from './engagement-config'
import { assignExperiment, bucketOf, EXPERIMENT_GROUPS, fnv1a } from './experiment-assignment'

import type { EngagementConfig } from './engagement-config'
import type { EngagementExperimentGroup } from './experiment-assignment'

function configWith(overrides: Partial<EngagementConfig> = {}): EngagementConfig {
  return { ...DEFAULT_ENGAGEMENT_CONFIG, ...overrides }
}

/** Первый игрок выборки, попавший в группу при данной доле трафика (§12.2). */
function findUserInGroup(group: EngagementExperimentGroup, share: number): string {
  for (let index = 0; index < 20_000; index++) {
    const userId = `user-${index}`
    const assignment = assignExperiment(userId, configWith({ experimentTrafficShare: share }))
    if (assignment.enrolled && assignment.group === group) {
      return userId
    }
  }
  throw new Error(`Группа ${group} не встретилась в выборке 20 000 игроков`)
}

describe('§12.5 доля трафика эксперимента', () => {
  it('доля 0 — эксперимент выключен, механики молчат', () => {
    const assignment = assignExperiment('user-1', configWith({ experimentTrafficShare: 0 }))
    expect(assignment.enrolled).toBe(false)
    expect(assignment.group).toBeNull()
    expect(assignment.flags).toEqual({
      ldwEnabled: false,
      nearMissEnabled: false,
      adaptiveRtpEnabled: false,
    })
  })

  it('доля 1 — полный роллаут: все в группе D (full)', () => {
    const assignment = assignExperiment('user-1', configWith({ experimentTrafficShare: 1 }))
    expect(assignment.enrolled).toBe(true)
    expect(assignment.group).toBe('full')
    expect(assignment.flags).toEqual({
      ldwEnabled: true,
      nearMissEnabled: true,
      adaptiveRtpEnabled: true,
    })
  })

  it('доля 0.5 — в эксперименте примерно половина игроков (детерминированно)', () => {
    const config = configWith({ experimentTrafficShare: 0.5 })
    let enrolled = 0
    for (let index = 0; index < 2000; index++) {
      if (assignExperiment(`user-${index}`, config).enrolled) {
        enrolled += 1
      }
    }
    const share = enrolled / 2000
    expect(share).toBeGreaterThan(0.4)
    expect(share).toBeLessThan(0.6)
  })

  it('внутри доли группы §12.2 распределены равномерно (по 20 %)', () => {
    const config = configWith({ experimentTrafficShare: 0.5 })
    const counts: Record<EngagementExperimentGroup, number> = {
      control: 0,
      ldw: 0,
      near_miss: 0,
      ldw_near_miss: 0,
      full: 0,
    }
    for (let index = 0; index < 5000; index++) {
      const assignment = assignExperiment(`user-${index}`, config)
      if (assignment.group) {
        counts[assignment.group] += 1
      }
    }
    const enrolled = Object.values(counts).reduce((sum, count) => sum + count, 0)
    expect(enrolled).toBeGreaterThan(0)
    for (const group of EXPERIMENT_GROUPS) {
      const groupShare = counts[group] / enrolled
      expect(groupShare).toBeGreaterThan(0.1)
      expect(groupShare).toBeLessThan(0.3)
    }
  })

  it('один игрок всегда получает одну и ту же группу (пока не сменилась соль)', () => {
    const config = configWith({ experimentTrafficShare: 0.5 })
    const first = assignExperiment('stable-user', config)
    const second = assignExperiment('stable-user', config)
    expect(second).toEqual(first)
  })

  it('смена соли перемешивает назначения', () => {
    const before = configWith({ experimentTrafficShare: 0.5 })
    const after = configWith({ experimentTrafficShare: 0.5, experimentSalt: 'engagement-v2' })
    let moved = 0
    for (let index = 0; index < 200; index++) {
      const userId = `user-${index}`
      if (assignExperiment(userId, before).group !== assignExperiment(userId, after).group) {
        moved += 1
      }
    }
    expect(moved).toBeGreaterThan(0)
  })
})

describe('§12.2 группы и их механики', () => {
  it('control — базовый RTP, без манипуляций', () => {
    const userId = findUserInGroup('control', 0.5)
    const assignment = assignExperiment(userId, configWith({ experimentTrafficShare: 0.5 }))
    expect(assignment.flags).toEqual({
      ldwEnabled: false,
      nearMissEnabled: false,
      adaptiveRtpEnabled: false,
    })
  })

  it('ldw — только LDW, адаптивный RTP включён', () => {
    const userId = findUserInGroup('ldw', 0.5)
    const assignment = assignExperiment(userId, configWith({ experimentTrafficShare: 0.5 }))
    expect(assignment.flags).toEqual({
      ldwEnabled: true,
      nearMissEnabled: false,
      adaptiveRtpEnabled: true,
    })
  })

  it('near_miss — только Near-Miss, адаптивный RTP включён', () => {
    const userId = findUserInGroup('near_miss', 0.5)
    const assignment = assignExperiment(userId, configWith({ experimentTrafficShare: 0.5 }))
    expect(assignment.flags).toEqual({
      ldwEnabled: false,
      nearMissEnabled: true,
      adaptiveRtpEnabled: true,
    })
  })

  it('ldw_near_miss — обе механики без адаптивного RTP', () => {
    const userId = findUserInGroup('ldw_near_miss', 0.5)
    const assignment = assignExperiment(userId, configWith({ experimentTrafficShare: 0.5 }))
    expect(assignment.flags).toEqual({
      ldwEnabled: true,
      nearMissEnabled: true,
      adaptiveRtpEnabled: false,
    })
  })

  it('full — полный движок: все механики', () => {
    const userId = findUserInGroup('full', 0.5)
    const assignment = assignExperiment(userId, configWith({ experimentTrafficShare: 0.5 }))
    expect(assignment.flags).toEqual({
      ldwEnabled: true,
      nearMissEnabled: true,
      adaptiveRtpEnabled: true,
    })
  })

  it('мастер-переключатели оператора сужают механики во всех группах', () => {
    const config = configWith({
      experimentTrafficShare: 1,
      ldwEnabled: false,
      nearMissEnabled: false,
    })
    const assignment = assignExperiment('user-1', config)
    expect(assignment.group).toBe('full')
    expect(assignment.flags).toEqual({
      ldwEnabled: false,
      nearMissEnabled: false,
      adaptiveRtpEnabled: true,
    })
  })
})

describe('FNV-1a и бакеты', () => {
  it('совпадает с эталонными значениями FNV-1a (32 бита)', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('a')).toBe(0xe40c292c)
  })

  it('бакет всегда в диапазоне 0…9999', () => {
    for (const input of ['', 'a', 'engagement-v1:group:user-1', 'юзер']) {
      const bucket = bucketOf(input)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThanOrEqual(9999)
    }
    expect(bucketOf('')).toBe(6261)
  })
})
