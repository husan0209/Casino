import { describe, expect, it } from 'vitest'

import { EngagementPhase } from '../src/domain/engagement-phase'
import { type EngagementState } from '../src/domain/types'
import { buildSessionMetadata } from '../src/engine/session-metadata'
import { createInitialState, markReactivation, recordSpin } from '../src/engine/state-transitions'

/** §3.2: имена полей в metadata — дословно эти десять. */
const TZ_FIELDS = [
  'score',
  'phase',
  'spinCount',
  'winCount',
  'ldwCount',
  'nearMissCount',
  'lastRtpAdjustment',
  'initialDeposit',
  'peakBalance',
  'reactivationTriggered',
]

function freshState(): EngagementState {
  return createInitialState({
    userId: 'player-1',
    gameId: 'fortunetiger',
    sessionId: 'session-1',
    initialDeposit: '1000',
    startedAt: new Date(0),
  })
}

/** Состояние «после игры»: 3 спина (проигрыш, LDW, near-miss) + реактивация. */
function playedState(): EngagementState {
  let state = freshState()
  state = recordSpin(state, {
    betTotal: '5',
    winTotal: '0',
    balanceAfter: '995',
    spinAt: new Date(1_000),
    isWin: false,
    isLdw: false,
    isNearMiss: false,
    targetRtp: '96',
  })
  state = recordSpin(state, {
    betTotal: '5',
    winTotal: '200',
    balanceAfter: '1190',
    spinAt: new Date(2_000),
    isWin: true,
    isLdw: true,
    isNearMiss: false,
    targetRtp: '105',
  })
  state = recordSpin(state, {
    betTotal: '5',
    winTotal: '1',
    balanceAfter: '1186',
    spinAt: new Date(3_000),
    isWin: true,
    isLdw: false,
    isNearMiss: true,
    targetRtp: '104.5',
  })
  state = { ...state, engagementScore: 62 }
  return markReactivation(state, {
    at: new Date(4_000),
    balanceAfter: '750',
    targetRtp: '105',
  })
}

describe('§3.2 buildSessionMetadata', () => {
  it('проецирует все поля готового состояния', () => {
    const metadata = buildSessionMetadata(playedState())

    expect(metadata.engagement).toEqual({
      score: 62,
      phase: EngagementPhase.REACTIVATION,
      spinCount: 3,
      winCount: 2,
      ldwCount: 1,
      nearMissCount: 1,
      lastRtpAdjustment: '104.5',
      initialDeposit: '1000',
      peakBalance: '1190',
      reactivationTriggered: true,
    })
  })

  it('отдаёт ровно блок engagement с полями §3.2, без лишних', () => {
    const metadata = buildSessionMetadata(playedState())

    expect(Object.keys(metadata)).toEqual(['engagement'])
    expect(Object.keys(metadata.engagement as object).sort()).toEqual([...TZ_FIELDS].sort())
  })

  it('стартовая сессия: нулевые счётчики и reactivationTriggered = false', () => {
    const engagement = buildSessionMetadata(freshState()).engagement

    expect(engagement).toEqual({
      score: 50,
      phase: EngagementPhase.ONBOARDING,
      spinCount: 0,
      winCount: 0,
      ldwCount: 0,
      nearMissCount: 0,
      lastRtpAdjustment: '0',
      initialDeposit: '1000',
      peakBalance: '1000',
      reactivationTriggered: false,
    })
  })

  it('денежные и процентные поля остаются Decimal-строками (правило №1)', () => {
    const engagement = buildSessionMetadata(playedState()).engagement as Record<string, unknown>

    for (const field of ['initialDeposit', 'peakBalance', 'lastRtpAdjustment']) {
      expect(typeof engagement[field]).toBe('string')
    }
    for (const field of ['score', 'spinCount', 'winCount', 'ldwCount', 'nearMissCount']) {
      expect(typeof engagement[field]).toBe('number')
    }
  })

  it('проекция не мутирует состояние и не держит на него ссылку', () => {
    const state = playedState()
    const snapshot = structuredClone(state)
    const engagement = buildSessionMetadata(state).engagement as Record<string, unknown>

    expect(state).toStrictEqual(snapshot)

    state.counters.nearMissCount = 99
    expect(engagement.nearMissCount).toBe(1)
  })
})
