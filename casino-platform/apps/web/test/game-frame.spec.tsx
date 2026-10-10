import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Игровой iframe (GAP-75): провайдер молчит — игрок не должен смотреть на
 * «Загрузка игры…» вечно, а смена игры не должна застывать в заглушке.
 */

import { GameFrame } from '@/components/game/GameFrame'

const STALL_MS = 12_000
const URL_ONE = 'https://provider.test/slot-a?token=1'
const URL_TWO = 'https://provider.test/slot-b?token=2'

const openSpy = vi.fn()

beforeEach(() => {
  openSpy.mockReset()
  window.open = openSpy as unknown as typeof window.open
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function frame(): HTMLElement | null {
  return document.querySelector('iframe')
}

describe('GameFrame', () => {
  it('iframe получает разрешения, которые просит слот, а не только fullscreen', () => {
    render(<GameFrame url={URL_ONE} />)
    const node = frame()

    expect(node).not.toBeNull()
    expect(node?.getAttribute('src')).toBe(URL_ONE)
    const allow = node?.getAttribute('allow') ?? ''
    for (const permission of ['fullscreen', 'autoplay', 'encrypted-media', 'gyroscope']) {
      expect(allow).toContain(permission)
    }
  })

  it('провайдер не ответил за 12 с — вместо бесконечной загрузки появляется выход', () => {
    render(<GameFrame url={URL_ONE} />)

    act((): void => {
      vi.advanceTimersByTime(STALL_MS - 1000)
    })
    expect(frame()).not.toBeNull()

    act((): void => {
      vi.advanceTimersByTime(2000)
    })
    expect(frame()).toBeNull()
    expect(screen.getByText(/Игра не открылась/)).toBeDefined()
  })

  it('ответивший iframe отменяет засечку', () => {
    render(<GameFrame url={URL_ONE} />)
    fireEvent.load(frame() as HTMLElement)

    act((): void => {
      vi.advanceTimersByTime(STALL_MS + 5000)
    })

    expect(frame()).not.toBeNull()
  })

  /**
   * Регресс: без сброса флагов по url заглушка переживала перемонтирование, и
   * вторая игра в той же сессии не открывалась никогда.
   */
  it('смена игры сбрасывает заглушку', () => {
    const view = render(<GameFrame url={URL_ONE} />)
    act((): void => {
      vi.advanceTimersByTime(STALL_MS + 1000)
    })
    expect(frame()).toBeNull()

    view.rerender(<GameFrame url={URL_TWO} />)

    expect(frame()?.getAttribute('src')).toBe(URL_TWO)
  })

  it('кнопка «Открыть игру» вне Telegram ведёт новую вкладку с noopener', () => {
    render(<GameFrame url={URL_ONE} />)
    act((): void => {
      vi.advanceTimersByTime(STALL_MS + 1000)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Открыть игру' }))

    expect(openSpy).toHaveBeenCalledWith(URL_ONE, '_blank', 'noopener')
  })
})
