/**
 * ТЗ ч.9 §16.1 п.21 — интеграционный тест полного цикла движка вовлечения:
 * депозит → ONBOARDING → RETENTION → RISK → REACTIVATION → COOLDOWN →
 * смена сессии → повтор цикла (§4.1–§5.3, §9.1, §10.1, §11.1, §11.3, §17).
 *
 * Тест гоняет движок ровно так, как это делает OriginalsSpinUseCase (§9.1):
 * prepare() до розыгрыша → applyMechanics() после → track() в конце.
 *
 * Детерминизм держат три вещи:
 *  - конфиг §10.2 движок читает из окружения лениво на каждый вызов, поэтому
 *    пороги короткого цикла ставятся в beforeEach и снимаются в afterEach;
 *  - балансы, ставки и времена передаются руками через prepare/apply/track:
 *    сигналы §6.2 («пауза после проигрыша», «медленные клики») задаются
 *    интервалами между `at` соседних спинов;
 *  - точечные срабатывания LDW/Near-Miss в ассертах не фиксируются — они
 *    случайны (§8.1/§8.2) и здесь только журналируются. Исключение —
 *    терминальный COOLDOWN: §17 обязывает механики молчать, и там
 *    `row === null` проверяется явно.
 *
 * Фикстуры (FakeEngagementRepository, fakeCache, makeRow) скопированы из
 * engagement-engine.spec.ts — по конвенции спеки не шарят двойников между
 * собой. Репозиторий здесь накопительный: saveState становится состоянием
 * следующего prepare(), а снимки и журнал копятся за весь сценарий.
 */
import { Decimal } from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { money } from '@casino/shared-utils'

import {
  EngagementEngineService,
  type PreparedSpin,
} from '../src/modules/casino/application/services/engagement-engine.service'
import { EngagementMetricsService } from '../src/modules/casino/application/services/engagement-metrics.service'
import { AdjustRtpUseCase } from '../src/modules/casino/application/use-cases/engagement/adjust-rtp.use-case'
import { CalculateEngagementUseCase } from '../src/modules/casino/application/use-cases/engagement/calculate-engagement.use-case'
import { CheckReactivationUseCase } from '../src/modules/casino/application/use-cases/engagement/check-reactivation.use-case'
import { GenerateNearMissUseCase } from '../src/modules/casino/application/use-cases/engagement/generate-near-miss.use-case'
import { SelectLdwUseCase } from '../src/modules/casino/application/use-cases/engagement/select-ldw.use-case'
import { TrackBehaviorUseCase } from '../src/modules/casino/application/use-cases/engagement/track-behavior.use-case'

import type { EngagementState } from '../src/modules/casino/domain/engagement'
import type { TigerActiveLine, TigerSpinRow } from '../src/modules/casino/domain/house-slot-game'
import type {
  EngagementEventInput,
  IEngagementRepository,
  SaveEngagementStateInput,
} from '../src/modules/casino/domain/repositories/engagement.repository'

const USER = 'user-cycle'
const GAME = 'game-1'
const SESSION_1 = 's1'
const SESSION_2 = 's2'
const DEPOSIT = '1000'
const BASE_RTP = 96
/** Начало сценария, мс epoch: все времена спинов — смещения от него. */
const T0 = 1_700_000_000_000

/**
 * Переменные §10.2, которыми тест сужает цикл: порог ONBOARDING — 2 спина,
 * одна реактивация за сессию (COOLDOWN достигается сразу после лимита),
 * пауза между реактивациями — 10 спинов, фаза реактивации — 3 спина.
 */
const ENGAGEMENT_ENV_KEYS = [
  'ENGAGEMENT_ENABLED',
  'ENGAGEMENT_EXPERIMENT_TRAFFIC_SHARE',
  'ENGAGEMENT_ONBOARDING_SPIN_THRESHOLD',
  'ENGAGEMENT_ONBOARDING_TARGET_RATIO',
  'ENGAGEMENT_MAX_REACTIVATIONS',
  'ENGAGEMENT_MIN_SPINS_BETWEEN_REACTIVATIONS',
  'ENGAGEMENT_REACTIVATION_PHASE_SPINS',
] as const

/** Репозиторий-двойник: держит состояние в памяти, копит журнал и записи. */
class FakeEngagementRepository implements IEngagementRepository {
  state: EngagementState | null = null
  readonly events: EngagementEventInput[] = []
  /** Все записи track() за сценарий — по одной на успешный спин. */
  readonly saves: SaveEngagementStateInput[] = []
  /** Последняя запись — срез состояния сразу после очередного спина. */
  saved: SaveEngagementStateInput | null = null

  async getState(): Promise<EngagementState | null> {
    return this.state
  }

  async saveState(input: SaveEngagementStateInput): Promise<void> {
    // Ключевое отличие от unit-фикстуры: запись становится состоянием
    // следующего prepare(), поэтому цикл фаз живёт через треки, а не через
    // заранее подготовленные stateWith()-объекты.
    this.state = input.state
    this.saves.push(input)
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

function buildService(
  repo: FakeEngagementRepository,
  metrics: EngagementMetricsService,
): EngagementEngineService {
  return new EngagementEngineService(
    new CalculateEngagementUseCase(repo, fakeCache),
    new AdjustRtpUseCase(),
    new CheckReactivationUseCase(),
    new SelectLdwUseCase(),
    new GenerateNearMissUseCase(),
    new TrackBehaviorUseCase(repo, fakeCache),
    repo,
    fakeCache,
    metrics,
  )
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

describe('ТЗ ч.9 §16.1 п.21 — полный цикл движка вовлечения (интеграционный)', () => {
  beforeEach(() => {
    process.env.ENGAGEMENT_ENABLED = 'true'
    process.env.ENGAGEMENT_EXPERIMENT_TRAFFIC_SHARE = '1'
    process.env.ENGAGEMENT_ONBOARDING_SPIN_THRESHOLD = '2'
    process.env.ENGAGEMENT_ONBOARDING_TARGET_RATIO = '1.25'
    process.env.ENGAGEMENT_MAX_REACTIVATIONS = '1'
    process.env.ENGAGEMENT_MIN_SPINS_BETWEEN_REACTIVATIONS = '10'
    process.env.ENGAGEMENT_REACTIVATION_PHASE_SPINS = '3'
  })

  afterEach(() => {
    for (const key of ENGAGEMENT_ENV_KEYS) {
      delete process.env[key]
    }
  })

  it('депозит → onboarding → retention → risk → reactivation → cooldown → новая сессия', async () => {
    const repo = new FakeEngagementRepository()
    const metrics = new EngagementMetricsService()
    const service = buildService(repo, metrics)
    /** Спины, реально прошедшие через track() — для сверки журнала §11.3. */
    const trackedPrepares: PreparedSpin[] = []

    const prepareSpin = async (input: {
      currentBalance: string
      now: number
      sessionId: string
    }): Promise<PreparedSpin> =>
      service.prepare({
        userId: USER,
        gameId: GAME,
        sessionId: input.sessionId,
        currency: 'RUB',
        currentBalance: input.currentBalance,
        baseRtpPercent: BASE_RTP,
        tableCeilingPercent: null,
        now: input.now,
      })

    /** Хвост §9.1: applyMechanics после розыгрыша и track в конце. */
    const trackSpin = async (input: {
      prepared: PreparedSpin
      sessionId: string
      bet: string
      win: string
      currentBalance: string
      at: number
      reactivationCredit?: string
    }): Promise<void> => {
      const mechanics = service.applyMechanics({
        prepared: input.prepared,
        winRows: WIN_ROWS,
        payoutModel: 'single',
      })
      trackedPrepares.push(input.prepared)
      await service.track({
        prepared: input.prepared,
        sessionId: input.sessionId,
        bet: input.bet,
        win: input.win,
        currentBalance: input.currentBalance,
        isLdw: mechanics.isLdw,
        isNearMiss: mechanics.isNearMiss,
        reactivationCredit: input.reactivationCredit ?? '0',
        mechanicsEvents: mechanics.pendingEvents,
        at: input.at,
      })
    }

    // ── Шаг 1. Старт: новая пара, депозит 1000 ₽ (§3.1, §4.1) ──────────────
    const t1 = T0
    const prepared1 = await prepareSpin({ currentBalance: DEPOSIT, now: t1, sessionId: SESSION_1 })
    expect(prepared1.enabled).toBe(true)
    expect(prepared1.context?.isNewState).toBe(true)
    expect(prepared1.context?.state.initialDeposit).toBe(DEPOSIT)
    expect(prepared1.phase).toBe('onboarding')
    // §7.3: первый спин тянет RTP к плану ONBOARDING (105–110), значит выше базы.
    expect(prepared1.rtpPercent ?? 0).toBeGreaterThan(BASE_RTP)
    await trackSpin({
      prepared: prepared1,
      sessionId: SESSION_1,
      bet: '10',
      win: '0',
      currentBalance: DEPOSIT,
      at: t1,
    })

    // ── Шаг 2. ONBOARDING → RETENTION по порогу спинов (§5.2) ──────────────
    const t2 = t1 + 2_000
    const prepared2 = await prepareSpin({ currentBalance: '1000', now: t2, sessionId: SESSION_1 })
    // Порог в 2 спина ещё не достигнут — фаза держится.
    expect(prepared2.context?.transition.changed).toBe(false)
    expect(prepared2.phase).toBe('onboarding')
    await trackSpin({
      prepared: prepared2,
      sessionId: SESSION_1,
      bet: '10',
      win: '0',
      currentBalance: '990',
      at: t2,
    })

    const t3 = t2 + 2_000
    const prepared3 = await prepareSpin({ currentBalance: '990', now: t3, sessionId: SESSION_1 })
    const toRetention = prepared3.context?.transition
    expect(toRetention?.changed).toBe(true)
    expect(toRetention?.phase).toBe('retention')
    expect(toRetention?.reason).toBe('spins_threshold')
    await trackSpin({
      prepared: prepared3,
      sessionId: SESSION_1,
      bet: '10',
      win: '0',
      currentBalance: '980',
      at: t3,
    })
    // Фаза решения FSM §5.2 сохраняется вместе со спином, а не только в логе.
    expect(repo.saved?.state.phase).toBe('retention')
    expect(repo.saved?.snapshot?.phase).toBe('retention')
    const retentionEvent = repo.events.find((event) => event.eventType === 'phase_changed')
    expect(retentionEvent?.payload['from']).toBe('onboarding')
    expect(retentionEvent?.payload['to']).toBe('retention')
    expect(retentionEvent?.payload['reason']).toBe('spins_threshold')

    // ── Шаг 3. RETENTION → RISK: медленные проигрыши (§6.2) ────────────────
    // Гэпы 40–50 с дают оба признака ухода: longPauseAfterLoss (тишина после
    // проигрыша > 30 с) и avgTimeBetweenSpins > 15 с. Баланс уводим к 40 %.
    const t4 = t3 + 45_000
    const prepared4 = await prepareSpin({ currentBalance: '980', now: t4, sessionId: SESSION_1 })
    expect(prepared4.phase).toBe('retention')
    await trackSpin({
      prepared: prepared4,
      sessionId: SESSION_1,
      bet: '100',
      win: '0',
      currentBalance: '880',
      at: t4,
    })

    const t5 = t4 + 50_000
    const prepared5 = await prepareSpin({ currentBalance: '880', now: t5, sessionId: SESSION_1 })
    await trackSpin({
      prepared: prepared5,
      sessionId: SESSION_1,
      bet: '100',
      win: '0',
      currentBalance: '780',
      at: t5,
    })

    const t6 = t5 + 40_000
    const prepared6 = await prepareSpin({ currentBalance: '780', now: t6, sessionId: SESSION_1 })
    await trackSpin({
      prepared: prepared6,
      sessionId: SESSION_1,
      bet: '100',
      win: '0',
      currentBalance: '680',
      at: t6,
    })

    const t7 = t6 + 45_000
    const prepared7 = await prepareSpin({ currentBalance: '680', now: t7, sessionId: SESSION_1 })
    await trackSpin({
      prepared: prepared7,
      sessionId: SESSION_1,
      bet: '280',
      win: '0',
      currentBalance: '400',
      at: t7,
    })
    expect(repo.saved?.state.currentBalance).toBe('400')

    const t8 = t7 + 45_000
    const prepared8 = await prepareSpin({ currentBalance: '400', now: t8, sessionId: SESSION_1 })
    // 40 % депозита (< 0.5) плюс признаки ухода → RISK (§5.2).
    expect(prepared8.phase).toBe('risk')
    expect(prepared8.context?.transition.reason).toBe('balance_below_half_and_churn')
    expect(prepared8.context?.signals.longPauseAfterLoss).toBe(true)
    await trackSpin({
      prepared: prepared8,
      sessionId: SESSION_1,
      bet: '250',
      win: '0',
      currentBalance: '150',
      at: t8,
    })
    expect(repo.saved?.state.phase).toBe('risk')

    // ── Шаг 4. RISK → REACTIVATION: баланс < 20 % — кредит §4.3 ────────────
    const t9 = t8 + 50_000
    const prepared9 = await prepareSpin({ currentBalance: '150', now: t9, sessionId: SESSION_1 })
    expect(prepared9.phase).toBe('reactivation')
    expect(prepared9.reactivation?.trigger).toBe(true)
    const credit = prepared9.reactivation?.creditAmount ?? '0'
    expect(money.isPositive(credit)).toBe(true)
    // §4.3: возврат в коридор 70–80 % базы и никогда — к 100 % депозита.
    const balanceAfterCredit = money.add('150', credit)
    expect(new Decimal(balanceAfterCredit).gte('700')).toBe(true)
    expect(new Decimal(balanceAfterCredit).lte('1000')).toBe(true)
    const spinsBeforeCredit = prepared9.context?.state.totalSpins
    await trackSpin({
      prepared: prepared9,
      sessionId: SESSION_1,
      bet: '10',
      win: '0',
      currentBalance: balanceAfterCredit,
      at: t9,
      reactivationCredit: credit,
    })
    // §4.3: счётчик растёт только на спине реально выданного кредита,
    // lastReactivationSpin — номер спина ДО инкремента (нумерация с нуля).
    expect(repo.saved?.state.reactivationCount).toBe(1)
    expect(repo.saved?.state.lastReactivationSpin).toBe(spinsBeforeCredit)
    const creditedEvent = repo.events.find((event) => event.eventType === 'reactivation_credited')
    expect(creditedEvent?.payload['creditAmount']).toBe(credit)
    expect(creditedEvent?.payload['reactivationCount']).toBe(1)

    // ── Шаг 5. REACTIVATION → COOLDOWN: лимит реактиваций исчерпан (§4.2) ──
    const t10 = t9 + 5_000
    const prepared10 = await prepareSpin({
      currentBalance: balanceAfterCredit,
      now: t10,
      sessionId: SESSION_1,
    })
    // Первый prepare после лимита MAX_REACTIVATIONS=1 переводит фазу в COOLDOWN.
    expect(prepared10.phase).toBe('cooldown')
    expect(prepared10.context?.transition.reason).toBe('reactivation_limit_reached')
    // §17: фаза спина считается до розыгрыша, поэтому спин, который входит
    // в COOLDOWN, уже «чистый» — механики к нему не применяются.
    const entryMechanics = service.applyMechanics({
      prepared: prepared10,
      winRows: WIN_ROWS,
      payoutModel: 'single',
    })
    expect(entryMechanics.row).toBeNull()
    expect(entryMechanics.isLdw).toBe(false)
    expect(entryMechanics.isNearMiss).toBe(false)
    // Снова уводим баланс ниже 20 % — движок больше не спасает (§4.2).
    await trackSpin({
      prepared: prepared10,
      sessionId: SESSION_1,
      bet: '50',
      win: '0',
      currentBalance: '100',
      at: t10,
    })

    const t11 = t10 + 45_000
    const prepared11 = await prepareSpin({ currentBalance: '100', now: t11, sessionId: SESSION_1 })
    expect(prepared11.phase).toBe('cooldown')
    expect(prepared11.context?.transition.changed).toBe(false)
    expect(prepared11.reactivation?.trigger).toBe(false)
    expect(prepared11.reactivation?.reason).toBe('limit_reached')
    // §17: в COOLDOWN LDW и Near-Miss обязаны молчать.
    const cooldownMechanics = service.applyMechanics({
      prepared: prepared11,
      winRows: WIN_ROWS,
      payoutModel: 'single',
    })
    expect(cooldownMechanics.row).toBeNull()
    expect(cooldownMechanics.isLdw).toBe(false)
    expect(cooldownMechanics.isNearMiss).toBe(false)

    // ── Шаг 6. Смена сессии перезапускает цикл (§10.1 resetState) ──────────
    const t12 = t11 + 5_000
    const prepared12 = await prepareSpin({ currentBalance: '100', now: t12, sessionId: SESSION_2 })
    expect(prepared12.context?.sessionReset).toBe(true)
    expect(prepared12.phase).toBe('onboarding')
    expect(prepared12.context?.state.totalSpins).toBe(0)
    expect(prepared12.context?.state.reactivationCount).toBe(0)
    // §3.1: база новой сессии — баланс на её старте.
    expect(prepared12.context?.state.initialDeposit).toBe('100')
    expect(prepared12.context?.state.lastSessionId).toBe(SESSION_2)

    // ── Шаг 7. §4.1 «ЭТАП 4: повтор цикла» в новой сессии ──────────────────
    // Лимит реактиваций §4.2 считается «за сессию», поэтому после сброса §10.1
    // цикл проходит заново: onboarding → retention → реактивация.
    await trackSpin({
      prepared: prepared12,
      sessionId: SESSION_2,
      bet: '10',
      win: '0',
      currentBalance: '90',
      at: t12,
    })

    const t13 = t12 + 2_000
    const prepared13 = await prepareSpin({ currentBalance: '90', now: t13, sessionId: SESSION_2 })
    expect(prepared13.phase).toBe('onboarding')
    await trackSpin({
      prepared: prepared13,
      sessionId: SESSION_2,
      bet: '15',
      win: '0',
      currentBalance: '75',
      at: t13,
    })

    const t14 = t13 + 2_000
    const prepared14 = await prepareSpin({ currentBalance: '75', now: t14, sessionId: SESSION_2 })
    // Тот же переход по спину, что и в s1: порог ONBOARDING достигнут.
    expect(prepared14.context?.transition.changed).toBe(true)
    expect(prepared14.phase).toBe('retention')
    await trackSpin({
      prepared: prepared14,
      sessionId: SESSION_2,
      bet: '60',
      win: '0',
      currentBalance: '15',
      at: t14,
    })

    const t15 = t14 + 5_000
    const prepared15 = await prepareSpin({ currentBalance: '15', now: t15, sessionId: SESSION_2 })
    // Критическая точка без признаков ухода: FSM держит RETENTION (§5.2),
    // но реактивация в новой сессии снова разрешена (§4.2).
    expect(prepared15.phase).toBe('retention')
    expect(prepared15.reactivation?.trigger).toBe(true)
    const credit2 = prepared15.reactivation?.creditAmount ?? '0'
    expect(money.isPositive(credit2)).toBe(true)
    // База s2 — 100 ₽: коридор 70–80 % — это 70–80 ₽, то есть ≤ базы.
    const balanceAfterCredit2 = money.add('15', credit2)
    expect(new Decimal(balanceAfterCredit2).gte('70')).toBe(true)
    expect(new Decimal(balanceAfterCredit2).lte('100')).toBe(true)
    const spinsBeforeCredit2 = prepared15.context?.state.totalSpins
    await trackSpin({
      prepared: prepared15,
      sessionId: SESSION_2,
      bet: '5',
      win: '0',
      currentBalance: balanceAfterCredit2,
      at: t15,
      reactivationCredit: credit2,
    })
    expect(repo.saved?.state.reactivationCount).toBe(1)
    expect(repo.saved?.state.lastReactivationSpin).toBe(spinsBeforeCredit2)

    // ── Шаг 8. Финальные агрегаты: журнал §11.3 и метрики §11.1 ────────────
    // rtp_adjusted готовится в prepare (pendingEvents) и пишется каждым track —
    // по одному решению на спин, включая спины с реактивацией и COOLDOWN.
    const rtpAdjusted = repo.events.filter((event) => event.eventType === 'rtp_adjusted')
    expect(rtpAdjusted).toHaveLength(repo.saves.length)
    expect(trackedPrepares.length).toBeGreaterThan(0)
    expect(
      trackedPrepares.every((prepared) =>
        prepared.pendingEvents.some((event) => event.eventType === 'rtp_adjusted'),
      ),
    ).toBe(true)
    const phaseChanged = repo.events.filter((event) => event.eventType === 'phase_changed')
    expect(
      phaseChanged.some(
        (event) => event.payload['from'] === 'onboarding' && event.payload['to'] === 'retention',
      ),
    ).toBe(true)
    expect(
      phaseChanged.some(
        (event) => event.payload['from'] === 'reactivation' && event.payload['to'] === 'cooldown',
      ),
    ).toBe(true)
    // По одной реактивации на сессию: s1 исчерпала лимит, s2 начала лимит заново.
    expect(repo.events.filter((event) => event.eventType === 'reactivation_credited')).toHaveLength(
      2,
    )

    // Метрики берём с экземпляра, переданного в конструктор движка, — не
    // из глобального снапшота процесса.
    const snapshot = metrics.snapshot()
    expect(snapshot.spins).toBe(repo.saves.length)
    expect(snapshot.sessionsStarted).toBeGreaterThanOrEqual(2)
    // §11.1: две сессии и по реактивации в каждой — не меньше одной на сессию.
    expect(snapshot.reactivationPerSession).toBeGreaterThanOrEqual(1)
    expect(snapshot.cooldownEntered).toBe(1)
  })
})
