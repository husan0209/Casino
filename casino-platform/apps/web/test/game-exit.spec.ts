/**
 * Выход из игры на `/play` — спека решения, а не рендера.
 *
 * Держит два правила, которые глазами не проверяются: «назад» только когда
 * игрок пришёл с нашего сайта (иначе кнопка выбрасывает его с него), и приём
 * закрытия по postMessage строго от своего происхождения.
 */
import { describe, expect, it, vi, type Mock } from 'vitest'

import { isCloseRequest, leaveGame, type LeaveGameDeps } from '../src/lib/ui/game-exit'

const ORIGIN = 'https://spinera.duckdns.org'

function makeDeps(over: { referrer?: string; historyLength?: number } = {}): {
  deps: LeaveGameDeps
  back: Mock
  home: Mock
} {
  const back = vi.fn()
  const home = vi.fn()
  const deps = {
    referrer: over.referrer ?? '',
    origin: ORIGIN,
    historyLength: over.historyLength ?? 2,
    back,
    home,
  }
  return { deps, back, home }
}

function messageEvent(over: { origin?: string; data?: unknown } = {}): MessageEvent {
  return {
    origin: over.origin ?? ORIGIN,
    data: over.data ?? { source: 'casino', type: 'close' },
  } as MessageEvent
}

describe('leaveGame', () => {
  it('пришёл с нашего сайта — уходит назад, а не на главную', () => {
    const { deps, back, home } = makeDeps({ referrer: `${ORIGIN}/casino` })

    expect(leaveGame(deps)).toBe('back')
    expect(back).toHaveBeenCalledTimes(1)
    expect(home).not.toHaveBeenCalled()
  })

  it('попал на /play по прямой ссылке — назад нельзя, иначе выбросит с сайта', () => {
    const { deps, back, home } = makeDeps({ referrer: '' })

    expect(leaveGame(deps)).toBe('home')
    expect(back).not.toHaveBeenCalled()
    expect(home).toHaveBeenCalledTimes(1)
  })

  it('пришёл с чужого домена — тоже на главную', () => {
    const { deps, back } = makeDeps({ referrer: 'https://example.com/casino' })

    expect(leaveGame(deps)).toBe('home')
    expect(back).not.toHaveBeenCalled()
  })

  it('истории возвращаться некуда (length 1) — на главную, несмотря на referrer', () => {
    const { deps, home } = makeDeps({ referrer: `${ORIGIN}/casino`, historyLength: 1 })

    expect(leaveGame(deps)).toBe('home')
    expect(home).toHaveBeenCalledTimes(1)
  })

  it('мусор вместо referrer не роняет выход', () => {
    const { deps } = makeDeps({ referrer: 'не url' })

    expect(leaveGame(deps)).toBe('home')
  })
})

describe('isCloseRequest', () => {
  it('своё происхождение и наш формат — закрытие принимаем', () => {
    expect(isCloseRequest(messageEvent(), ORIGIN)).toBe(true)
  })

  it('чужое происхождение — игнорируем: иначе любой фрейм командует навигацией', () => {
    expect(isCloseRequest(messageEvent({ origin: 'https://evil.example' }), ORIGIN)).toBe(false)
  })

  it('чужой формат сообщения — не закрытие', () => {
    expect(isCloseRequest(messageEvent({ data: { source: 'other', type: 'close' } }), ORIGIN)).toBe(
      false,
    )
    expect(isCloseRequest(messageEvent({ data: { source: 'casino', type: 'resize' } }), ORIGIN)).toBe(
      false,
    )
    expect(isCloseRequest(messageEvent({ data: 'close' }), ORIGIN)).toBe(false)
    // `null` нельзя передавать через `over.data ?? default`: nullish-слияние
    // подставит валидное сообщение, и тест станет зелёным сам по себе
    expect(isCloseRequest({ origin: ORIGIN, data: null } as MessageEvent, ORIGIN)).toBe(false)
  })
})
