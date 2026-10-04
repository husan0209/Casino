/**
 * Правило F4 (ТЗ ч.8 §13.2): «депозит ровно на порог».
 *
 * Проверямое здесь — коридор и его границы, а не текст: правило сравнивает
 * деньги, и ошибка на копейку превращает честного партнёра в подозреваемого
 * (или наоборот, и тогда флаг не ставится вовсе).
 */
import { describe, expect, it } from 'vitest'

import {
  NEAR_THRESHOLD_RATIO,
  isNearThresholdDeposit,
} from '../domain/value-objects/deposit-threshold-band.value-object'

describe('isNearThresholdDeposit', () => {
  it('помечает депозит ровно на порог', () => {
    expect(isNearThresholdDeposit('500.00000000', '500')).toBe(true)
  })

  it('помечает в пределах коридора с обеих сторон', () => {
    // порог 500, коридор 1% = 5 RUB: 496 и 504 — внутри
    expect(isNearThresholdDeposit('496', '500')).toBe(true)
    expect(isNearThresholdDeposit('504', '500')).toBe(true)
  })

  it('граница коридора включительна', () => {
    expect(isNearThresholdDeposit('495', '500')).toBe(true)
    expect(isNearThresholdDeposit('505', '500')).toBe(true)
  })

  it('не помечает депозит за границей коридора', () => {
    expect(isNearThresholdDeposit('494.99', '500')).toBe(false)
    expect(isNearThresholdDeposit('505.01', '500')).toBe(false)
  })

  it('не помечает платёж, вдвое превышающий порог', () => {
    expect(isNearThresholdDeposit('1000', '500')).toBe(false)
  })

  it('порог 0 («без порога») отключает правило', () => {
    // Сравнивать с нулём бессмысленно, а 1% от нуля — тоже ноль: любая сумма
    // попадала бы в коридор только при точном совпадении с нулём, то есть
    // флаг вешался бы на нулевую заявку вместо того, чтобы молчать.
    expect(isNearThresholdDeposit('0', '0')).toBe(false)
    expect(isNearThresholdDeposit('500', '0')).toBe(false)
  })

  it('считает коридор в десятичных, а не в двоичных долях', () => {
    // 505.00000001 не должен залезть в коридор из-за float-округления, и
    // узкий порог не должен схлопнуться в ноль
    expect(isNearThresholdDeposit('505.00000001', '500')).toBe(false)
    expect(isNearThresholdDeposit('0.05000000', '0.05')).toBe(true)
    expect(isNearThresholdDeposit('0.06', '0.05')).toBe(false)
  })

  it('коридор — 1% от порога', () => {
    expect(NEAR_THRESHOLD_RATIO.toString()).toBe('0.01')
  })
})
