import { Decimal } from 'decimal.js'

import { RTP_CEILING, RTP_FLOOR, RTP_RANGES, RTP_TUNING } from '../config'
import { EngagementPhase } from '../domain/engagement-phase'
import { type EngagementState, type MoneyAmount, type PlayerBehaviorSignals } from '../domain/types'

/**
 * §7.1 шаг 3: поведенческая корректировка (формула §7.1, а не §6.3 — см. README).
 *
 * Канон — §7.1: каждый сигнал даёт свой аддитивный вес из
 * RTP_TUNING.behaviorModifiers. §6.3 описывает другую таблицу (биграммы
 * «rapidClicking && increasing -> -3»), которая §7.1 противоречит; по README
 * она не используется. Возвращаем сумму весов: азарт сушит RTP (минус),
 * уходящий игрок получает прибавку (плюс).
 */
export function calculateBehaviorModifier(signals: PlayerBehaviorSignals): number {
  const weights = RTP_TUNING.behaviorModifiers
  let modifier = new Decimal(0)
  if (signals.rapidClicking) {
    modifier = modifier.plus(weights.rapidClicking)
  }
  if (signals.betTrend === 'increasing') {
    modifier = modifier.plus(weights.betTrendIncreasing)
  }
  if (signals.slowClicking) {
    modifier = modifier.plus(weights.slowClicking)
  }
  if (signals.decreasingBetCount) {
    modifier = modifier.plus(weights.decreasingBetCount)
  }
  if (signals.longPauseAfterLoss) {
    modifier = modifier.plus(weights.longPauseAfterLoss)
  }
  return modifier.toNumber()
}

/**
 * §7.1: компенсация дрейфа накопленного RTP.
 *
 * Пока |drift| в шумовой полосе driftNoiseBandPercent — не трогаем. Иначе
 * сдвигаем целевой RTP против дрейфа: cumulative RTP выше целевого (drift > 0)
 * => следующий RTP ниже; ниже целевого (drift < 0) => выше. Сдвиг равен
 * coefficient * |drift|, но не больше driftCompensationCap.
 */
export function compensateRtpDrift(targetRtp: number, rtpDrift: number): number {
  return applyDriftCompensation(targetRtp, rtpDrift).adjustedRtp
}

/**
 * §7.3: не давать RTP прыгнуть больше чем на maxChangePerSpin за спин.
 * Дефолт шага — RTP_TUNING.maxRtpChangePerSpin (§7.3 = 2).
 */
export function smoothRtpTransition(
  currentRtp: number,
  targetRtp: number,
  maxChangePerSpin: number = RTP_TUNING.maxRtpChangePerSpin,
): number {
  const diff = new Decimal(targetRtp).minus(currentRtp)
  if (diff.isZero()) {
    return targetRtp
  }
  const step = Decimal.min(diff.abs(), maxChangePerSpin).times(diff.s)
  return new Decimal(currentRtp).plus(step).toNumber()
}

export interface RtpAdjustment {
  /** Уже сглаженный и ограниченный RTP: идёт в лотерею. */
  targetRtp: MoneyAmount
  /** Насколько дрейф сдвинул RTP (для SpinPlan и метрик §11). */
  driftCompensation: number
  /** Причина, по которой RTP был срезан: table-ceiling или глобальные границы. */
  clampedBy: 'none' | 'table-ceiling' | 'global-range'
}

/**
 * §7.1: полный расчёт адаптированного RTP.
 *
 * tableCeiling — потолок, который отдают таблицы игры (houseSlotRtpCeiling).
 * Он обязательен: у Fortune Ox и Fortune Panda базовый RTP 70 %, и фазовый
 * диапазон 105–110 % для них недостижим — лотерея на таком целевом бросает
 * OriginalsRtpUnreachableError. Лаборатория обязана это заметить и сообщить,
 * а не молча подменить цифру.
 */
export function adjustRtp(args: {
  baseRtp: number
  score: number
  phase: EngagementPhase
  signals: PlayerBehaviorSignals
  state: EngagementState
  tableCeiling: number
}): RtpAdjustment {
  const range = RTP_RANGES[args.phase]
  const ratio = new Decimal(clampScore(args.score)).div(100)
  // Шаг 2: линейная интерполяция по score между min и max диапазона фазы.
  const interpolated = new Decimal(range.min).plus(
    new Decimal(range.max).minus(range.min).times(ratio),
  )

  // Шаг 3: поведенческая корректировка.
  const withBehavior = interpolated.plus(calculateBehaviorModifier(args.signals))

  // Шаг 4: компенсация дрейфа накопленного RTP (метрика §11 — фактический сдвиг).
  const drift = new Decimal(args.state.rtpDrift).toNumber()
  const compensation = applyDriftCompensation(withBehavior.toNumber(), drift)

  // Шаг 5: срезка глобальными границами §17 (90–110).
  const globalClamped = Decimal.min(Decimal.max(compensation.adjustedRtp, RTP_FLOOR), RTP_CEILING)
  const clampedByGlobal = !globalClamped.equals(compensation.adjustedRtp)

  // §7.3: сглаживание относительно RTP, действовавшего на прошлом спине.
  // appliedRtp = 0/пусто означает «прошлого спина не было»: гасить прыжок
  // некуда, иначе первый спин стартует с ~2% и разгоняется по +2% за спин.
  const appliedRtp = new Decimal(args.state.appliedRtp || 0)
  const smoothed = appliedRtp.isZero()
    ? globalClamped
    : new Decimal(smoothRtpTransition(appliedRtp.toNumber(), globalClamped.toNumber()))

  // Потолок таблиц: итоговая отсечка сверху, важнее глобального CEILING для
  // узких игр (Ox/Panda). Если режет сильнее глобальных границ — причина он.
  const ceilingClamped = Decimal.min(smoothed, args.tableCeiling)
  const clampedByTable = !ceilingClamped.equals(smoothed)
  const finalRtp = clampedByTable ? ceilingClamped : smoothed

  return {
    targetRtp: finalRtp.toDecimalPlaces(6).toString(),
    driftCompensation: compensation.shift,
    clampedBy: clampedByTable ? 'table-ceiling' : clampedByGlobal ? 'global-range' : 'none',
  }
}

interface DriftCompensationResult {
  adjustedRtp: number
  /** Фактический сдвиг, который внёс дрейф: adjustedRtp - targetRtp. */
  shift: number
}

/**
 * Одна реализация компенсационной формулы, чтобы compensateRtpDrift (§7.1
 * шаг 4) и adjustRtp не разъезжались по знакам и капу.
 */
function applyDriftCompensation(targetRtp: number, rtpDrift: number): DriftCompensationResult {
  const { driftNoiseBandPercent, driftCompensationFactor, driftCompensationCap } = RTP_TUNING
  if (new Decimal(rtpDrift).abs().lt(driftNoiseBandPercent)) {
    return { adjustedRtp: targetRtp, shift: 0 }
  }
  // compensationFactor > 0 при drift > 0 => RTP снижаем (counter-sign), и наоборот.
  const factor = new Decimal(rtpDrift).abs().times(driftCompensationFactor)
  const capped = Decimal.min(factor, driftCompensationCap).times(new Decimal(rtpDrift).s)
  const adjustedRtp = new Decimal(targetRtp).minus(capped).toNumber()
  return { adjustedRtp, shift: capped.negated().toNumber() }
}

/** score по ТЗ 0–100: выход за пределы не должен ломать интерполяцию. */
function clampScore(score: number): number {
  if (Number.isNaN(score)) {
    return 0
  }
  return Math.min(100, Math.max(0, score))
}
