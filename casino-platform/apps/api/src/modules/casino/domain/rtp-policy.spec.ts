import { describe, expect, it } from 'vitest'

import {
  DEMO_RTP_DEFAULT_PERCENT,
  MONEY_RTP_DEFAULT_PERCENT,
  demoRtpPercent,
  moneyRtpPercent,
} from './rtp-policy'

/**
 * Цель возврата читается из карточки игры одним резолвером на все движки:
 * деньги — не выше 100 %, демо — щедрое по умолчанию и не выше потолка таблиц.
 */
describe('rtp-policy: деньги', () => {
  it('берёт значение админа, включая дробное', () => {
    expect(moneyRtpPercent('70')).toBe('70')
    expect(moneyRtpPercent('96.5')).toBe('96.5')
  })

  it('пустое и мусорное значение — витрина по умолчанию', () => {
    expect(moneyRtpPercent(null)).toBe(MONEY_RTP_DEFAULT_PERCENT)
    expect(moneyRtpPercent(undefined)).toBe(MONEY_RTP_DEFAULT_PERCENT)
    expect(moneyRtpPercent('garbage')).toBe(MONEY_RTP_DEFAULT_PERCENT)
  })

  it('деньги не могут быть выше 100 % и ниже нуля', () => {
    expect(moneyRtpPercent('140')).toBe('100')
    expect(moneyRtpPercent('-5')).toBe('0')
    expect(moneyRtpPercent('0')).toBe('0')
  })
})

describe('rtp-policy: демо', () => {
  it('без значения админа — щедрая цель', () => {
    expect(demoRtpPercent(null, 200)).toBe(String(DEMO_RTP_DEFAULT_PERCENT))
    expect(demoRtpPercent('', 200)).toBe(String(DEMO_RTP_DEFAULT_PERCENT))
  })

  it('значение админа важнее дефолта', () => {
    expect(demoRtpPercent('150', 200)).toBe('150')
    expect(demoRtpPercent('110', 200)).toBe('110')
  })

  it('потолок таблиц ниже цели режет её, а не роняет спин', () => {
    expect(demoRtpPercent(null, 89.61)).toBe('89')
    expect(demoRtpPercent('150', 89.61)).toBe('89')
  })

  it('в потолок попадает и точное значение', () => {
    expect(demoRtpPercent('120', 120)).toBe('120')
  })
})
