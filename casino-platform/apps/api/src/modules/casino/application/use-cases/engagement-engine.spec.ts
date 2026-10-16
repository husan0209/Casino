import { Decimal } from 'decimal.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { EngagementEngineService } from '../services/engagement-engine.service'
import { EngagementMetricsService } from '../services/engagement-metrics.service'
import { AdjustRtpUseCase } from './engagement/adjust-rtp.use-case'
import { CalculateEngagementUseCase } from './engagement/calculate-engagement.use-case'
import { CheckReactivationUseCase } from './engagement/check-reactivation.use-case'
import { GenerateNearMissUseCase } from './engagement/generate-near-miss.use-case'
import { SelectLdwUseCase } from './engagement/select-ldw.use-case'
import { TrackBehaviorUseCase } from './engagement/track-behavior.use-case'
import { DEFAULT_ENGAGEMENT_CONFIG } from '../../domain/engagement'

import type { EngagementState } from '../../domain/engagement'
import type { TigerActiveLine, TigerSpinRow } from '../../domain/house-slot-game'
import type {
  EngagementEventInput,
  IEngagementRepository,
  SaveEngagementStateInput,
} from '../../domain/repositories/engagement.repository'

const USER = 'user-1'
const GAME = 'game-1'
const SESSION = 'session-1'

/** Репозиторий-двойник: держит состояние в памяти и пишет журнал. */
class FakeEngagementRepository implements IEngagementRepository {
  state: EngagementState | null = null
  readonly events: EngagementEventInput[] = []
  saved: SaveEngagementStateInput | null = null

  async getState(): Promise<EngagementState | null> {
    return this.state
  }

  async saveState(input: SaveEngagementStateInput): Promise<void> {
    this.saved = input
  }

  async appendEvent(event: EngagementEventInput): Promise<void> {
    this.events.push(event)
  }
}

/** Кэш-двойник §6.4. */
const fakeCache = {
  getScore: async () => null,
  setScore: async () => {},
  invalidate: async () => {},
}

function buildService(repo: FakeEngagementRepository): EngagementEngineService {
  return new EngagementEngineService(
    new CalculateEngagementUseCase(repo, fakeCache),
    new AdjustRtpUseCase(),
    new CheckReactivationUseCase(),
    new SelectLdwUseCase(),
    new GenerateNearMissUseCase(),
    new TrackBehaviorUseCase(repo, fakeCache),
    repo,
    fakeCache,
    new EngagementMetricsService(),
  )
}

function stateWith(overrides: Partial<EngagementState>): EngagementState {
  const repo = new FakeEngagementRepository()
  const service = buildService(repo)
  void service
  return {
    userId: USER,
    gameId: GAME,
    currency: 'RUB',
    phase: 'onboarding',
    rtpDrift: '0',
    totalSpins: 0,
    totalBet: '0',
    totalWin: '0',
    lastWinAmount: '0',
    maxWinInSession: '0',
    ldwCount: 0,
    nearMissCount: 0,
    lastLdwSpin: 0,
    reactivationCount: 0,
    lastReactivationSpin: null,
    initialDeposit: '1000',
    currentBalance: '150',
    peakBalance: '1000',
    behavior: { spins: [] },
    sessionSnapshot: null,
    lastSpinAt: null,
    lastSessionId: SESSION,
    ...overrides,
  }
}

function makeRow(payout: number, combine: number): TigerSpinRow {
  const line: TigerActiveLine = {
    index: 1,
    name: 'line-1',
    combine,
    way_243: 0,
    payout,
    multiply: 1,
    active_icon: Array.from({ length: combine }, (_, i) => i),
  }
  return [['sym-a', 'sym-a', 'sym-b'], [0, 0, 1], [line], [], combine, payout]
}

const WIN_ROWS: TigerSpinRow[] = [makeRow(0.4, 2), makeRow(0.5, 2), makeRow(0.05, 3), makeRow(5, 3)]

describe('§9.1 движок вовлечения: приёмка §16.2', () => {
  beforeEach(() => {
    process.env.ENGAGEMENT_ENABLED = 'true'
    delete process.env.ENGAGEMENT_EXPERIMENT_TRAFFIC_SHARE
  })

  it('§1. мастер-выключатель: без ENGAGEMENT_ENABLED спин не трогается', () => {
    delete process.env.ENGAGEMENT_ENABLED
    const service = buildService(new FakeEngagementRepository())
    expect(service.isEnabledFor(USER, false)).toBe(false)
    process.env.ENGAGEMENT_ENABLED = 'true'
    expect(service.isEnabledFor(USER, false)).toBe(true)
  })

  it('§2. движок никогда не включается в демо-режиме (§17)', () => {
    const service = buildService(new FakeEngagementRepository())
    expect(service.isEnabledFor(USER, true)).toBe(false)
  })

  it('§2.1 доля трафика 0 выключает движок даже при включённом мастере (§12.5)', async () => {
    process.env.ENGAGEMENT_EXPERIMENT_TRAFFIC_SHARE = '0'
    const service = buildService(new FakeEngagementRepository())
    expect(service.isEnabledFor(USER, false)).toBe(false)
    const prepared = await service.prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '1000',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    expect(prepared.enabled).toBe(false)
    expect(prepared.context).toBeNull()
    expect(prepared.pendingEvents).toEqual([])
  })

  it('§3. «медовый месяц»: план ONBOARDING — RTP выше 100 % (§5.3, 105–110)', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({ phase: 'onboarding', totalSpins: 2, currentBalance: '1000' })
    const service = buildService(repo)
    const prepared = await service.prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '1000',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    expect(prepared.enabled).toBe(true)
    expect(prepared.context?.cycle.step).toBe('pillar')
    // План фазы — в коридоре 105…110.
    const target = prepared.rtpPercent as number
    expect(target).toBeGreaterThan(96)
    expect(target).toBeLessThanOrEqual(110)
  })

  it('§3a. сглаживание §7.3 не даёт RTP прыгнуть больше чем на 2 п.п. за спин', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({ phase: 'onboarding', totalSpins: 0, currentBalance: '1000' })
    const service = buildService(repo)
    // Первый спин пары: RTP разгоняется от базового 96 шагом не больше 2 п.п.
    const first = await service.prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '1000',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    expect(first.rtpPercent as number).toBeLessThanOrEqual(98)
    expect(first.rtpPercent as number).toBeGreaterThan(96)
  })

  it('§4. реактивация возвращает баланс в коридор 70–80 % (§4.3)', async () => {
    const repo = new FakeEngagementRepository()
    // Первое падение ниже 20 % в паре: реактивация обязана сработать сразу.
    repo.state = stateWith({
      phase: 'retention',
      totalSpins: 3,
      reactivationCount: 0,
      lastReactivationSpin: null,
      currentBalance: '150',
    })
    const prepared = await buildService(repo).prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '150',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    expect(prepared.reactivation?.trigger).toBe(true)
    const target = new Decimal(prepared.reactivation?.targetBalance ?? '0')
    expect(target.gte('700')).toBe(true)
    expect(target.lte('800')).toBe(true)
    expect(new Decimal(prepared.reactivation?.creditAmount ?? '0').gt(0)).toBe(true)
  })

  it('§5. после лимита реактиваций фаза уходит в COOLDOWN и механики молчат', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({
      phase: 'reactivation',
      totalSpins: 80,
      reactivationCount: DEFAULT_ENGAGEMENT_CONFIG.maxReactivations,
      lastReactivationSpin: 60,
      currentBalance: '150',
    })
    const service = buildService(repo)
    const prepared = await service.prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '150',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })

    expect(prepared.phase).toBe('cooldown')
    // Реактивация больше не предлагается — лимит исчерпан.
    expect(prepared.reactivation?.trigger).toBe(false)

    // Механики не применяются ни на этом спине, ни последующих: фаза считается
    // ДО подмены исхода, поэтому «входной» спин в COOLDOWN тоже чистый.
    for (let i = 0; i < 50; i++) {
      const mechanics = service.applyMechanics({
        prepared,
        winRows: WIN_ROWS,
        payoutModel: 'single',
      })
      expect(mechanics.row).toBeNull()
      expect(mechanics.isLdw).toBe(false)
      expect(mechanics.isNearMiss).toBe(false)
    }
  })

  it('§6. в COOLDOWN RTP спина равен базовому (§5.3)', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({
      phase: 'cooldown',
      totalSpins: 90,
      reactivationCount: DEFAULT_ENGAGEMENT_CONFIG.maxReactivations,
      lastReactivationSpin: 70,
      currentBalance: '150',
    })
    const prepared = await buildService(repo).prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '150',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    expect(prepared.phase).toBe('cooldown')
    expect(prepared.rtpPercent).toBe(96)
  })

  it('§7. трек пишет состояние и журнал, счётчики растут', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({ phase: 'onboarding', totalSpins: 1, currentBalance: '1000' })
    const service = buildService(repo)
    const prepared = await service.prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '1000',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    await service.track({
      prepared,
      sessionId: SESSION,
      bet: '10',
      win: '12',
      currentBalance: '1002',
      isLdw: false,
      isNearMiss: false,
      reactivationCredit: '0',
    })
    expect(repo.saved).not.toBeNull()
    expect(repo.saved?.state.totalSpins).toBe(2)
    expect(repo.saved?.currentBalance).toBe('1002')
    expect(repo.saved?.state.behavior.spins).toHaveLength(1)
  })

  it('§8. кредит реактивации попадает в журнал (§11.3)', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({ phase: 'retention', totalSpins: 30, currentBalance: '150' })
    const service = buildService(repo)
    const prepared = await service.prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '150',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    const credit = prepared.reactivation?.creditAmount ?? '0'
    expect(new Decimal(credit).gt(0)).toBe(true)

    await service.track({
      prepared,
      sessionId: SESSION,
      bet: '10',
      win: '0',
      currentBalance: new Decimal('150').plus(credit).toFixed(8),
      isLdw: false,
      isNearMiss: false,
      reactivationCredit: credit,
    })

    const credited = repo.events.find((e) => e.eventType === 'reactivation_credited')
    expect(credited).toBeDefined()
    expect(credited?.sessionId).toBe(SESSION)
    expect(credited?.payload['creditAmount']).toBe(credit)
  })

  it('§9. новое состояние начинается с базы = баланс на первом спине (§3.1)', async () => {
    const repo = new FakeEngagementRepository()
    const prepared = await buildService(repo).prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '1000',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    expect(prepared.context?.isNewState).toBe(true)
    expect(prepared.context?.state.initialDeposit).toBe('1000')
    expect(prepared.context?.state.phase).toBe('onboarding')
  })

  it('§10. фаза FSM сохраняется, снапшот и phase_changed пишутся (§5.2, §3.2)', async () => {
    const repo = new FakeEngagementRepository()
    // Баланс 130 % депозита закрывает ONBOARDING по guard-условию §5.2.
    repo.state = stateWith({ phase: 'onboarding', totalSpins: 2, currentBalance: '1300' })
    const service = buildService(repo)
    const prepared = await service.prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '1300',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    expect(prepared.phase).toBe('retention')

    await service.track({
      prepared,
      sessionId: SESSION,
      bet: '10',
      win: '0',
      currentBalance: '1290',
      isLdw: false,
      isNearMiss: false,
      reactivationCredit: '0',
    })

    // Регрессия: до фикса nextState.phase оставался старым, и переход
    // RETENTION/RISK/REACTIVATION/COOLDOWN повторить было невозможно.
    expect(repo.saved?.state.phase).toBe('retention')
    expect(repo.saved?.snapshot?.phase).toBe('retention')
    // Пик сессии пересчитывается на спине: баланс после спина 1290 > прошлый пик 1000.
    expect(repo.saved?.snapshot?.peakBalance).toBe('1290')
    const changed = repo.events.find((e) => e.eventType === 'phase_changed')
    expect(changed?.payload['from']).toBe('onboarding')
    expect(changed?.payload['to']).toBe('retention')
  })

  it('§11. кредит реактивации поднимает счётчик и номер спина (§4.3)', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({ phase: 'retention', totalSpins: 30, currentBalance: '150' })
    const service = buildService(repo)
    const prepared = await service.prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '150',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    const credit = prepared.reactivation?.creditAmount ?? '0'
    expect(new Decimal(credit).gt(0)).toBe(true)

    await service.track({
      prepared,
      sessionId: SESSION,
      bet: '10',
      win: '0',
      currentBalance: new Decimal('150').plus(credit).toFixed(8),
      isLdw: false,
      isNearMiss: false,
      reactivationCredit: credit,
    })

    // Регрессия: до фикса счётчик оставался нулевым, лимит §4.2 и пауза
    // §4.3 не работали — кредит выдавался на каждом спине.
    expect(repo.saved?.state.reactivationCount).toBe(1)
    expect(repo.saved?.state.lastReactivationSpin).toBe(30)
    const credited = repo.events.find((e) => e.eventType === 'reactivation_credited')
    expect(credited?.payload['reactivationCount']).toBe(1)
  })

  it('§12. дрейф RTP считается в п.п. от плана фазы (§7.1)', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({ phase: 'onboarding', totalSpins: 1, currentBalance: '1000' })
    const service = buildService(repo)
    const prepared = await service.prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '1000',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })
    await service.track({
      prepared,
      sessionId: SESSION,
      bet: '10',
      win: '12',
      currentBalance: '1002',
      isLdw: false,
      isNearMiss: false,
      reactivationCredit: '0',
    })

    // cumulativeRtp = 12/10 → 120 %, план ONBOARDING 107.5 → дрейф +12.500 п.п.
    // Регрессия: до фикса в колонке лежали деньги (для ставки 100 — «9600»),
    // и компенсация §7.1 насыщалась на каждом спине.
    expect(repo.saved?.state.rtpDrift).toBe('12.500')
    // Пик баланса §3.1 обновляется по факту спина.
    expect(repo.saved?.state.peakBalance).toBe('1002')
  })

  it('§13. смена сессии перезапускает цикл (§10.1 resetState)', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({
      phase: 'risk',
      totalSpins: 40,
      reactivationCount: 3,
      lastReactivationSpin: 20,
      initialDeposit: '500',
      currentBalance: '200',
      lastSessionId: 'session-old',
    })
    const prepared = await buildService(repo).prepare({
      userId: USER,
      gameId: GAME,
      sessionId: SESSION,
      currency: 'RUB',
      currentBalance: '200',
      baseRtpPercent: 96,
      tableCeilingPercent: null,
    })

    expect(prepared.context?.sessionReset).toBe(true)
    expect(prepared.context?.state.phase).toBe('onboarding')
    expect(prepared.context?.state.reactivationCount).toBe(0)
    expect(prepared.context?.state.lastReactivationSpin).toBeNull()
    // §3.1: база новой сессии — баланс на её старте.
    expect(prepared.context?.state.initialDeposit).toBe('200')
    expect(prepared.context?.state.lastSessionId).toBe(SESSION)
  })

  it('§14. публичный resetState приводит пару к чистому циклу (§10.1)', async () => {
    const repo = new FakeEngagementRepository()
    repo.state = stateWith({ phase: 'cooldown', totalSpins: 90, reactivationCount: 4 })
    const service = buildService(repo)

    await service.resetState({
      userId: USER,
      gameId: GAME,
      currency: 'RUB',
      initialDeposit: '700',
      sessionId: SESSION,
    })

    expect(repo.saved?.state.phase).toBe('onboarding')
    expect(repo.saved?.state.totalSpins).toBe(0)
    expect(repo.saved?.state.initialDeposit).toBe('700')
    expect(repo.saved?.snapshot).toBeNull()
  })
})
