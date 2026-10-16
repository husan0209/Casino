/**
 * ТЗ ч.9 §3.1 — состояние движка вовлечения по паре (игрок, игра).
 *
 * VO живёт в домене и не знает про Prisma: репозиторий отдаёт его из строки
 * БД, use-case отдаёт его же на запись. Денежные величины — строки
 * (`MoneyAmount`), как требует правило G20 проекта; ratio-счёт идёт через
 * Decimal, а не через `parseFloat` из псевдокода ТЗ — иначе теряются
 * копейки на длинных сессиях.
 *
 * Единицы `rtpDrift` — процентные пункты (как в ТЗ §3.1: `cumulativeRtp −
 * targetRtp`), а не деньги: дрейф отвечает на вопрос «насколько фактическая
 * отдача разошлась с планом фазы». Компенсация §7.1 ожидает те же п.п.
 */
import { Decimal } from 'decimal.js'

import type { Currency, MoneyAmount } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import type { EngagementPhase } from './engagement-phase'

/** Длина кольцевых буферов §6.2: 100 последних спинов. */
export const BEHAVIOR_BUFFER_SIZE = 100

/**
 * §7.1 — дрейф RTP в процентных пунктах: `cumulativeRtp − targetRtp`.
 * Хранится строкой (Decimal), чтобы не терять точность на границе NUMERIC.
 */
export type RtpDriftPercent = string

/** Один записанный спин в кольцевом буфере. */
export interface BehaviorSpinRecord {
  /** Метка времени спина, мс epoch. */
  at: number
  /** Ставка спина (MoneyAmount). */
  bet: MoneyAmount
  /** Выплата спина (MoneyAmount). */
  win: MoneyAmount
  /** Спин был выигрышным — нужно для longPauseAfterLoss. */
  isWin: boolean
}

/** Кольцевые буферы §6.2 (лежат в колонке behavior JSONB). */
export interface BehaviorBuffers {
  readonly spins: readonly BehaviorSpinRecord[]
}

/** Снапшот для metadata активной сессии §3.2. */
export interface EngagementSessionSnapshot {
  phase: EngagementPhase
  score: number
  balanceRatio: number
  cycleTargetBalance: MoneyAmount
  cycleStep: string
  reactivationCount: number
  /** §3.1 — пик баланса сессии: виден в снапшоте для аналитики §11.1. */
  peakBalance: MoneyAmount
  lastUpdatedAt: number
}

/** Состояние движка на момент начала спина. */
export interface EngagementState {
  readonly userId: string
  readonly gameId: string
  readonly currency: Currency
  /** Текущая фаза §5. */
  phase: EngagementPhase
  /** §7.1 — накопленный дрейф RTP в п.п.: cumulativeRtp − плановый RTP фазы. */
  rtpDrift: RtpDriftPercent
  totalSpins: number
  totalBet: MoneyAmount
  totalWin: MoneyAmount
  lastWinAmount: MoneyAmount
  maxWinInSession: MoneyAmount
  ldwCount: number
  nearMissCount: number
  lastLdwSpin: number
  reactivationCount: number
  /**
   * §4.3 условие 3 — номер последней реактивации (счётчик спинов ДО спина
   * кредита, нумерация с нуля); null = реактиваций ещё не было.
   * null и 0 — разные вещи: до первой реактивации пауза «в N спинов» не
   * применяется, иначе игрок, впервые опустившийся ниже 20 %, не получал бы
   * реактивацию первые 10 спинов сессии. В БД колонка nullable — 0 хранится
   * как обычное значение (кредит возможен и на первом спине сессии).
   */
  lastReactivationSpin: number | null
  /**
   * §4.1 — база виртуальной подушки: баланс на момент первого спина сессии.
   * От неё считаются доли баланса во всех guard-условиях §5.2. При смене
   * сессии (§10.1 resetState) база обновляется вместе с циклом.
   */
  initialDeposit: MoneyAmount
  /** Текущий баланс кошелька на последнем известном движке. */
  currentBalance: MoneyAmount
  /** §3.1 — пик баланса сессии; обновляется на каждом спине. */
  peakBalance: MoneyAmount
  readonly behavior: BehaviorBuffers
  sessionSnapshot: EngagementSessionSnapshot | null
  lastSpinAt: Date | null
  /**
   * Сессия последнего записанного спина. Смена значения = новая сессия
   * (§10.1 `resetState`): цикл баланса и лимит реактиваций считаются
   * «за сессию» §4.2, поэтому при запуске новой сессии цикл начинается заново.
   */
  lastSessionId: string | null
}

/** Начальное состояние для новой пары (игрок, игра). */
export function createEngagementState(args: {
  userId: string
  gameId: string
  currency: Currency
  initialDeposit: MoneyAmount
  currentBalance: MoneyAmount
  sessionId?: string | null
}): EngagementState {
  return {
    userId: args.userId,
    gameId: args.gameId,
    currency: args.currency,
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
    initialDeposit: args.initialDeposit,
    currentBalance: args.currentBalance,
    peakBalance: args.currentBalance,
    behavior: { spins: [] },
    sessionSnapshot: null,
    lastSpinAt: null,
    lastSessionId: args.sessionId ?? null,
  }
}

/**
 * §10.1 `resetState` — новая сессия: цикл §4.1 начинается заново, базой
 * становится текущий баланс, лимит реактиваций сбрасывается (§4.2 «за
 * сессию»), поведенческие буферы очищаются (сессия — новая история).
 * Идентичность пары (userId/gameId/currency) не трогается.
 */
export function resetForNewSession(args: {
  state: EngagementState
  currentBalance: MoneyAmount
  sessionId: string | null
}): EngagementState {
  return {
    ...args.state,
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
    initialDeposit: args.currentBalance,
    currentBalance: args.currentBalance,
    peakBalance: args.currentBalance,
    behavior: { spins: [] },
    sessionSnapshot: null,
    lastSpinAt: null,
    lastSessionId: args.sessionId,
  }
}

/**
 * Доля баланса от базы §4.1. При нулевом депозите возвращаем 1: делить не на что,
 * и «баланс равен базе» — безопасная трактовка для guard-условий (они не срабатывают).
 */
export function balanceRatioOf(state: EngagementState, currentBalance: MoneyAmount): number {
  const base = new Decimal(state.initialDeposit)
  if (base.lte(0)) {
    return 1
  }
  return new Decimal(currentBalance).div(base).toNumber()
}

/** Накопленный RTP сессии в процентах; null, пока ставок не было. */
export function cumulativeRtpPercent(state: EngagementState): number | null {
  const bet = new Decimal(state.totalBet)
  if (bet.lte(0)) {
    return null
  }
  return new Decimal(state.totalWin).div(bet).times(100).toNumber()
}

/** Спинов с последнего LDW — вход §8.1 (частота «каждые 3–4 спина»). */
export function spinsSinceLastLdw(state: EngagementState): number {
  return state.totalSpins - state.lastLdwSpin
}

/**
 * §7.1 — дрейф после спина: `cumulativeRtp − targetRtp` в процентных пунктах,
 * три знака как в схеме §3.1. Плановая точка — RTP фазы спина (середина
 * диапазона §7.2): дрейф меряет расхождение с планом, а не с мгновенной
 * скорректированной ставкой.
 */
export function rtpDriftAfterSpin(args: {
  totalBet: MoneyAmount
  totalWin: MoneyAmount
  targetRtpPercent: number
}): RtpDriftPercent {
  const bet = new Decimal(args.totalBet)
  if (bet.lte(0)) {
    return '0'
  }
  const cumulativeRtp = new Decimal(args.totalWin).div(bet).times(100)
  return cumulativeRtp.minus(args.targetRtpPercent).toDecimalPlaces(3).toFixed(3)
}

/**
 * Записывает спин в кольцевой буфер и обновляет накопительные счётчики §3.1.
 *
 * Единственная точка мутации состояния по спину: фаза (решение FSM §5.2),
 * счётчик реактиваций (§4.3 — растёт только когда кредит реально выдан),
 * дрейф (§7.1 — пересчитывается от новых итогов), пик баланса (§3.1) и
 * кольцевые буферы обновляются здесь, чтобы состояние и журнал не разошлись.
 */
export function applySpinToState(args: {
  state: EngagementState
  bet: MoneyAmount
  win: MoneyAmount
  /** Баланс после спина — уже с учётом кредита реактивации, если он был. */
  currentBalance: MoneyAmount
  at: number
  isLdw: boolean
  isNearMiss: boolean
  /** Фаза, посчитанная FSM на этом спине (§5.2); она же фиксируется в состоянии. */
  nextPhase: EngagementPhase
  /** §4.3 — кредит реактивации выдан на этом спине. */
  reactivationTriggered: boolean
  /** Плановый RTP фазы спина — цель дрейфа §7.1. */
  targetRtpPercent: number
  sessionId: string | null
}): EngagementState {
  const { state, bet, win, at, isLdw, isNearMiss } = args
  const isWin = new Decimal(win).gt(0)
  const record: BehaviorSpinRecord = { at, bet, win, isWin }
  const spins = [...state.behavior.spins, record].slice(-BEHAVIOR_BUFFER_SIZE)

  const totalBet = money.add(state.totalBet, bet)
  const totalWin = money.add(state.totalWin, win)
  const currentBalance = args.currentBalance
  const peakBalance = new Decimal(currentBalance).gt(state.peakBalance)
    ? currentBalance
    : state.peakBalance

  return {
    ...state,
    phase: args.nextPhase,
    totalSpins: state.totalSpins + 1,
    totalBet,
    totalWin,
    rtpDrift: rtpDriftAfterSpin({
      totalBet,
      totalWin,
      targetRtpPercent: args.targetRtpPercent,
    }),
    lastWinAmount: win,
    maxWinInSession: new Decimal(win).gt(state.maxWinInSession) ? win : state.maxWinInSession,
    ldwCount: isLdw ? state.ldwCount + 1 : state.ldwCount,
    nearMissCount: isNearMiss ? state.nearMissCount + 1 : state.nearMissCount,
    lastLdwSpin: isLdw ? state.totalSpins : state.lastLdwSpin,
    // §4.3: нумерация с нуля, как у lastLdwSpin — хранится счётчик спинов
    // ДО спина кредита; «пауза в 10 спинов» отсчитывается от него.
    reactivationCount: args.reactivationTriggered
      ? state.reactivationCount + 1
      : state.reactivationCount,
    lastReactivationSpin: args.reactivationTriggered
      ? state.totalSpins
      : state.lastReactivationSpin,
    currentBalance,
    peakBalance,
    behavior: { spins },
    lastSpinAt: new Date(at),
    lastSessionId: args.sessionId ?? state.lastSessionId,
  }
}

/** Последние N записей буфера — «окно» для сигналов §6.2. */
export function recentSpins(state: EngagementState, count: number): readonly BehaviorSpinRecord[] {
  return state.behavior.spins.slice(-count)
}
