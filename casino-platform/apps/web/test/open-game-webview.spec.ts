import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Открытие демо-игры (GAP-21): в Telegram Mini App нет новых вкладок, поэтому
 * игра обязана ехать в этом же документе на /play — иначе игрок выпадает из
 * приложения в системный браузер и теряет сессию.
 */

import { demoGameHref, openDemoGame } from '@/lib/open-game'

interface TelegramWindow {
  Telegram?: { WebApp?: { initData: string } }
}

function installBridge(): void {
  const scopedWindow = window as Window & TelegramWindow
  scopedWindow.Telegram = { WebApp: { initData: 'raw=1' } }
}

function removeBridge(): void {
  delete (window as Window & TelegramWindow).Telegram
}

const openSpy = vi.fn()
const navigateSpy = vi.fn()

beforeEach(() => {
  openSpy.mockReset()
  navigateSpy.mockReset()
  removeBridge()
  window.open = openSpy as unknown as typeof window.open
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('openDemoGame', () => {
  it('обычный браузер — новая вкладка с noopener, навигация не тронута', () => {
    openDemoGame('book-of-adel', 'https://provider.test/demo?token=abc', navigateSpy)

    expect(openSpy).toHaveBeenCalledWith(
      'https://provider.test/demo?token=abc',
      '_blank',
      'noopener',
    )
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('Telegram Mini App — тот же документ, маршрут /play, вкладка не открывается', () => {
    installBridge()

    openDemoGame('book-of-adel', 'https://provider.test/demo?token=abc', navigateSpy)

    expect(openSpy).not.toHaveBeenCalled()
    expect(navigateSpy).toHaveBeenCalledWith(
      '/casino/book-of-adel/play?url=https%3A%2F%2Fprovider.test%2Fdemo%3Ftoken%3Dabc',
    )
  })

  /**
   * URL провайдера прилетает из ответа API и попадает в query НАШЕГО роута, а
   * оттуда — в `src` iframe. Кодируем целиком: иначе `&x=1` стал бы нашим
   * параметром, а не частью чужого адреса, и игра поехала бы без токена.
   */
  it('чужие & и = внутри launch_url не разбираются как наши параметры', () => {
    const launchUrl = 'https://provider.test/g?a=1&b=/play?c=2'

    const target = new URL(demoGameHref('slot', launchUrl), 'https://casino.test')

    expect(target.pathname).toBe('/casino/slot/play')
    expect(target.searchParams.get('url')).toBe(launchUrl)
  })
})
