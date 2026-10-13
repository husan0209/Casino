import { describe, expect, it } from 'vitest'

import { realMoneyStep } from '@/lib/ui/game-launch'

/**
 * Что делает тап по «Играть на деньги» (§4.5). Раньше этот выбор был зашит в
 * трёх компонентах витрины, и игрок без денег вместо карточки игры получал
 * кассовый экран: здесь ровно та развилка, вынесенная в одно место.
 */
describe('realMoneyStep', () => {
  it('гость идёт во вход, даже если баланс уже известен', () => {
    expect(realMoneyStep({ signedIn: false, balance: '500' })).toBe('login')
    expect(realMoneyStep({ signedIn: false, balance: '0' })).toBe('login')
  })

  it('пустой кошелёк — касса, а не попытка запуска', () => {
    expect(realMoneyStep({ signedIn: true, balance: '0' })).toBe('deposit')
    expect(realMoneyStep({ signedIn: true, balance: '0.00' })).toBe('deposit')
  })

  it('отрицательного баланса не бывает, но и он не повод запускать игру', () => {
    expect(realMoneyStep({ signedIn: true, balance: '-1' })).toBe('deposit')
  })

  it('есть деньги — запуск', () => {
    expect(realMoneyStep({ signedIn: true, balance: '0.01' })).toBe('launch')
    expect(realMoneyStep({ signedIn: true, balance: '1200.50' })).toBe('launch')
  })

  it('незагруженный кошелёк (null) не считается пустым: решает сервер', () => {
    expect(realMoneyStep({ signedIn: true, balance: null })).toBe('launch')
  })
})
