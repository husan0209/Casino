import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Открытие демо-игры (GAP-21): всегда в этом же документе на /play. В Telegram
 * Mini App новых вкладок не существует в принципе, а в обычном браузере новая
 * вкладка означала потерю шапки казино и отсутствие выхода из голого клиента
 * игры — поэтому теперь оба пути идут через один маршрут.
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
  it('обычный браузер — та же вкладка, маршрут /play с планкой выхода', () => {
    openDemoGame('book-of-adel', 'https://provider.test/demo?token=abc', navigateSpy)

    expect(navigateSpy).toHaveBeenCalledWith(
      '/casino/book-of-adel/play?url=https%3A%2F%2Fprovider.test%2Fdemo%3Ftoken%3Dabc',
    )
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('Telegram Mini App — так же в этом же документе, вкладка не открывается', () => {
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
