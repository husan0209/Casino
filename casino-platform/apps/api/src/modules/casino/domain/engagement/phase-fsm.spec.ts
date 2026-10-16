import { describe, expect, it } from 'vitest'

import { DEFAULT_ENGAGEMENT_CONFIG } from './engagement-config'
import { createEngagementState, type EngagementState } from './engagement-state.vo'
import { nextPhase, spinsSinceReactivation } from './phase-fsm'
import { computeBehaviorSignals, hasChurnRisk } from './player-behavior.vo'

import type { EngagementPhase } from './engagement-phase'
import type { PlayerBehaviorSignals } from './player-behavior.vo'

const NOW = 1_700_000_000_000
const CONFIG = DEFAULT_ENGAGEMENT_CONFIG

function stateWith(overrides: Partial<EngagementState> = {}): EngagementState {
  const base = createEngagementState({
    userId: 'user-1',
    gameId: 'game-1',
    currency: 'RUB',
    initialDeposit: '1000',
    currentBalance: '1000',
  })
  return { ...base, ...overrides }
}

/** Плохие сигналы = признаки ухода: пауза после проигрыша и медленный клик. */
function churnSignals(balance: string): PlayerBehaviorSignals {
  // Три проигрыша подряд, последний — 40 секунд назад: §6.2 даёт и паузу после
  // проигрыша, и «медленные клики» (3 спина за 5 минут при пороге 15).
  const state = stateWith({
    currentBalance: balance,
    behavior: {
      spins: [
        { at: NOW - 90_000, bet: '10', win: '0', isWin: false },
        { at: NOW - 70_000, bet: '10', win: '0', isWin: false },
        { at: NOW - 40_000, bet: '10', win: '0', isWin: false },
      ],
    },
  })
  const signals = computeBehaviorSignals(state, balance, NOW)
  // Тест падает, если «признаки ухода» не сработали: иначе проверка перехода
  // ниже проверяла бы путь, которого в реальности не бывает.
  expect(hasChurnRisk(signals)).toBe(true)
  return signals
}

describe('§5.2 FSM: переходы фаз', () => {
  it('ONBOARDING → RETENTION по порогу спинов', () => {
    const state = stateWith({ phase: 'onboarding', totalSpins: CONFIG.onboardingSpinThreshold })
    const transition = nextPhase({
      state,
      currentBalance: '1000',
      signals: churnSignals('1000'),
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('retention')
    expect(transition.changed).toBe(true)
    expect(transition.reason).toBe('spins_threshold')
  })

  it('ONBOARDING → RETENTION по достигнутой подушке (+25 %)', () => {
    const state = stateWith({ phase: 'onboarding', totalSpins: 3 })
    const transition = nextPhase({
      state,
      currentBalance: '1300',
      signals: churnSignals('1300'),
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('retention')
    expect(transition.reason).toBe('pillar_target_reached')
  })

  it('ONBOARDING держится до порога, даже если баланс просел', () => {
    const state = stateWith({ phase: 'onboarding', totalSpins: 2 })
    const transition = nextPhase({
      state,
      currentBalance: '400',
      signals: churnSignals('400'),
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('onboarding')
    expect(transition.changed).toBe(false)
  })

  it('RETENTION → RISK при балансе < 50 % и признаках ухода', () => {
    const state = stateWith({ phase: 'retention', totalSpins: 40 })
    const transition = nextPhase({
      state,
      currentBalance: '400',
      signals: churnSignals('400'),
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('risk')
    expect(transition.reason).toBe('balance_below_half_and_churn')
  })

  it('RETENTION не уходит в RISK без признаков ухода', () => {
    const state = stateWith({ phase: 'retention', totalSpins: 40, behavior: { spins: [] } })
    const signals = computeBehaviorSignals(state, '400', NOW)
    const transition = nextPhase({
      state,
      currentBalance: '400',
      signals,
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('retention')
  })

  it('RISK → REACTIVATION ниже критической точки', () => {
    const state = stateWith({ phase: 'risk', totalSpins: 50 })
    const transition = nextPhase({
      state,
      currentBalance: '150',
      signals: churnSignals('150'),
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('reactivation')
  })

  it('REACTIVATION → RETENTION после возврата к 70 %', () => {
    const state = stateWith({
      phase: 'reactivation',
      totalSpins: 60,
      lastReactivationSpin: 50,
      reactivationCount: 1,
    })
    const transition = nextPhase({
      state,
      currentBalance: '750',
      signals: churnSignals('750'),
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('retention')
    expect(transition.reason).toBe('recovered_to_70_percent')
  })

  it('REACTIVATION → COOLDOWN по исчерпанию лимита', () => {
    const state = stateWith({
      phase: 'reactivation',
      totalSpins: 60,
      lastReactivationSpin: 50,
      reactivationCount: CONFIG.maxReactivations,
    })
    const transition = nextPhase({
      state,
      currentBalance: '150',
      signals: churnSignals('150'),
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('cooldown')
    expect(transition.reason).toBe('reactivation_limit_reached')
  })

  it('COOLDOWN терминален: из него нельзя выйти обратно в вовлечение', () => {
    const state = stateWith({ phase: 'cooldown', totalSpins: 90, reactivationCount: 4 })
    const balance = '150'
    const transition = nextPhase({
      state,
      currentBalance: balance,
      signals: churnSignals(balance),
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('cooldown')
    expect(transition.reason).toBe('terminal_phase_hold')
  })

  it('COOLDOWN → DORMANT после 30 минут тишины (§5.2)', () => {
    const state = stateWith({
      phase: 'cooldown',
      totalSpins: 90,
      lastSpinAt: new Date(NOW - 31 * 60 * 1000),
    })
    const transition = nextPhase({
      state,
      currentBalance: '150',
      signals: churnSignals('150'),
      config: CONFIG,
      now: NOW,
    })
    expect(transition.phase).toBe('dormant')
    expect(transition.reason).toBe('inactive_over_30_min')
  })

  it('закрытая сессия уводит в DORMANT из любой фазы (§5.2)', () => {
    const phases: EngagementPhase[] = ['onboarding', 'retention', 'risk', 'reactivation']
    for (const phase of phases) {
      const transition = nextPhase({
        state: stateWith({ phase }),
        currentBalance: '800',
        signals: churnSignals('800'),
        config: CONFIG,
        sessionEnded: true,
        now: NOW,
      })
      expect(transition.phase).toBe('dormant')
    }
  })
})

describe('§4.3 условие 3: пауза между реактивациями', () => {
  it('до первой реактивации пауза не применяется', () => {
    const state = stateWith({ totalSpins: 1, lastReactivationSpin: null, reactivationCount: 0 })
    expect(spinsSinceReactivation(state)).toBeNull()
  })

  it('после реактивации пауза считается от её спина', () => {
    const state = stateWith({ totalSpins: 12, lastReactivationSpin: 7, reactivationCount: 1 })
    expect(spinsSinceReactivation(state)).toBe(5)
  })
})
