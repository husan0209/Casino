import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { CheckReactivationUseCase } from './check-reactivation.use-case'
import { DEFAULT_ENGAGEMENT_CONFIG } from '../../../domain/engagement'
import { createEngagementState, type EngagementState } from '../../../domain/engagement'

const CONFIG = DEFAULT_ENGAGEMENT_CONFIG
const useCase = new CheckReactivationUseCase()
/** Детерминированный «случайный» выбор внутри коридора. */
const fixedRandom = (): number => 0.5

function stateWith(overrides: Partial<EngagementState> = {}): EngagementState {
  const base = createEngagementState({
    userId: 'user-1',
    gameId: 'game-1',
    currency: 'RUB',
    initialDeposit: '1000',
    currentBalance: '150',
  })
  return { ...base, ...overrides }
}

describe('§4.3 CheckReactivationUseCase', () => {
  it('не срабатывает, пока баланс выше 20 % базы', () => {
    const decision = useCase.execute({
      state: stateWith({ totalSpins: 30 }),
      currentBalance: '250',
      config: CONFIG,
      random: fixedRandom,
    })
    expect(decision.trigger).toBe(false)
    expect(decision.reason).toBe('balance_above_threshold')
  })

  it('срабатывает при первом падении ниже 20 % — без «разогрева» в 10 спинов', () => {
    // Регрессия к багу лаборатории: условие 3 ТЗ считалось как
    // totalSpins - lastReactivationSpin, что на свежей сессии блокировало
    // первую реактивацию до 10-го спина.
    const decision = useCase.execute({
      state: stateWith({ totalSpins: 1, lastReactivationSpin: null, reactivationCount: 0 }),
      currentBalance: '150',
      config: CONFIG,
      random: fixedRandom,
    })
    expect(decision.trigger).toBe(true)
    expect(decision.reason).toBe('triggered')
  })

  it('возвращает баланс в коридор 70–80 % от базы (§4.3, «не к 100 %»)', () => {
    const decision = useCase.execute({
      state: stateWith({ totalSpins: 20 }),
      currentBalance: '150',
      config: CONFIG,
      random: fixedRandom,
    })
    expect(decision.trigger).toBe(true)
    const target = new Decimal(decision.targetBalance ?? '0')
    expect(target.gte('700')).toBe(true)
    expect(target.lte('800')).toBe(true)
  })

  it('сумма к кредиту равна разнице до цели', () => {
    const decision = useCase.execute({
      state: stateWith({ totalSpins: 20 }),
      currentBalance: '150',
      config: CONFIG,
      random: fixedRandom,
    })
    const target = new Decimal(decision.targetBalance ?? '0')
    const credit = new Decimal(decision.creditAmount)
    expect(credit.plus('150').toFixed(8)).toBe(target.toFixed(8))
  })

  it('не превышает лимит реактиваций за сессию (§4.2: 3–4)', () => {
    const decision = useCase.execute({
      state: stateWith({
        totalSpins: 40,
        reactivationCount: CONFIG.maxReactivations,
        lastReactivationSpin: 5,
      }),
      currentBalance: '150',
      config: CONFIG,
      random: fixedRandom,
    })
    expect(decision.trigger).toBe(false)
    expect(decision.reason).toBe('limit_reached')
  })

  it('уважает паузу между реактивациями', () => {
    const decision = useCase.execute({
      state: stateWith({ totalSpins: 5, reactivationCount: 1, lastReactivationSpin: 3 }),
      currentBalance: '150',
      config: CONFIG,
      random: fixedRandom,
    })
    expect(decision.trigger).toBe(false)
    expect(decision.reason).toBe('cooldown_between_reactivations')
  })

  it('при лимите 0 реактивации выключены полностью', () => {
    const decision = useCase.execute({
      state: stateWith({ totalSpins: 20 }),
      currentBalance: '150',
      config: { ...CONFIG, maxReactivations: 0 },
      random: fixedRandom,
    })
    expect(decision.trigger).toBe(false)
  })

  it('не делит на ноль при нулевой базе', () => {
    const decision = useCase.execute({
      state: stateWith({ totalSpins: 5, initialDeposit: '0' }),
      currentBalance: '0',
      config: CONFIG,
      random: fixedRandom,
    })
    expect(decision.trigger).toBe(false)
    expect(Number.isFinite(decision.balanceRatio)).toBe(true)
  })

  it('кредит всегда неотрицателен', () => {
    const decision = useCase.execute({
      state: stateWith({ totalSpins: 20 }),
      currentBalance: '0',
      config: CONFIG,
      random: fixedRandom,
    })
    expect(new Decimal(decision.creditAmount).gte(0)).toBe(true)
  })
})
