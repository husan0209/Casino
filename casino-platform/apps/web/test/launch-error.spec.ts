/**
 * GAP-55 (в): юнит-тесты маппинга ошибок запуска в экраны (ТЗ ч.5 §8.4).
 * Проверяем, что все шесть случаев ТЗ имеют свой экран, у каждого есть
 * следующий шаг (§2.3.9), и что тихой конвертации валюты не предлагается
 * вместо поддержки — только смена кошелька/пополнение/каталог.
 */
import { describe, expect, it } from 'vitest'

import { describeLaunchError, LAUNCH_ACTION_LABELS } from '../src/lib/ui/launch-error'

describe('GAP-55 §8.4 — каждый случай ошибки запуска имеет экран', () => {
  const cases: { input: Parameters<typeof describeLaunchError>[0]; mustInclude: string }[] = [
    { input: { code: 'GAME_DISABLED' }, mustInclude: 'недоступна' },
    { input: { code: 'PROVIDER_MAINTENANCE' }, mustInclude: 'Техработы' },
    { input: { code: 'GAME_SESSION_INVALID' }, mustInclude: 'уже открыта' },
    { input: { code: 'INSUFFICIENT_FUNDS' }, mustInclude: 'Недостаточно' },
    { input: { code: 'CURRENCY_NOT_SUPPORTED' }, mustInclude: 'Валюта' },
    { input: { network: true }, mustInclude: 'не ответил' },
  ]

  for (const { input, mustInclude } of cases) {
    const view = describeLaunchError(input)
    it(`${input.code ?? 'network'} → «${view.title}»`, () => {
      expect(view.title.toLowerCase()).toContain(mustInclude.toLowerCase())
      expect(view.text.length).toBeGreaterThan(10)
      expect(view.actions.length).toBeGreaterThan(0)
    })
  }

  it('все заголовки различны — экраны не схлопываются в один текст', () => {
    const titles = new Set(
      cases.map((testCase) => describeLaunchError(testCase.input).title),
    )
    expect(titles.size).toBe(cases.length)
  })
})

describe('GAP-55 — следующий шаг вместо тупика (§2.3.9)', () => {
  it('недостаточно средств → пополнение, а не просто «ошибка»', () => {
    expect(describeLaunchError({ code: 'INSUFFICIENT_FUNDS' }).actions).toContain('deposit')
  })

  it('валюта не поддерживается → смена кошелька, без обещания конвертировать', () => {
    const view = describeLaunchError({ code: 'CURRENCY_NOT_SUPPORTED' })
    expect(view.actions).toContain('switch_currency')
    expect(view.text.toLowerCase()).toContain('конвертац')
    expect(view.text.toLowerCase()).not.toContain('мы сконвертируем')
  })

  it('техработы → есть «попробовать снова» и выход в каталог', () => {
    const actions = describeLaunchError({ code: 'PROVIDER_MAINTENANCE' }).actions
    expect(actions).toEqual(expect.arrayContaining(['retry', 'catalog']))
  })

  it('провайдер не ответил → повтор обязателен', () => {
    expect(describeLaunchError({ status: 504 }).actions).toContain('retry')
  })
})

describe('GAP-55 — фолбэки', () => {
  it('5xx без известного кода — экран «провайдер не ответил»', () => {
    expect(describeLaunchError({ status: 500 }).title).toBe('Провайдер не ответил')
  })

  it('неизвестный код и 4xx — общий экран с повтором и поддержкой', () => {
    const view = describeLaunchError({ code: 'SOMETHING_NEW', status: 403 })
    expect(view.actions).toEqual(expect.arrayContaining(['retry', 'support']))
  })

  it('несогласованных кодов не боимся: у любого вью есть подписи у всех действий', () => {
    const view = describeLaunchError({ code: 'WALLET_NOT_FOUND' })
    for (const action of view.actions) {
      expect(LAUNCH_ACTION_LABELS[action].length).toBeGreaterThan(2)
    }
  })

  it('response есть, но 4xx — это НЕ таймаут (сеть ≠ отсутствие ответа)', () => {
    expect(describeLaunchError({ status: 422, network: false }).title).toBe(
      'Не удалось запустить игру',
    )
  })
})
