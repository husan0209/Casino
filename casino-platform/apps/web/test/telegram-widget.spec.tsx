import { cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UC-AUTH-09: настоящий Telegram Login Widget.
 * - скрипт telegram-widget.js инжектится с ботом из NEXT_PUBLIC_TELEGRAM_BOT_NAME
 *   и глобальным колбэком data-onauth;
 * - данные виджета (id/auth_date приходят числами) конвертируются в строки до
 *   POST /auth/telegram — DTO API (TelegramLoginSchema) требует строки.
 * Iframe с нативной кнопкой рендерится только на домене из /setdomain — в
 * jsdom тестируем инжект скрипта и проводку колбэка, не сам Telegram.
 */

vi.hoisted(() => {
  process.env['NEXT_PUBLIC_TELEGRAM_BOT_NAME'] = 'test_bot'
})

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

vi.mock('@/lib/api', () => api)

import {
  exchangeTelegramAuth,
  TelegramLoginWidget,
  type TelegramAuthPayload,
} from '@/components/auth/oauth'

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiPost.mockReset()
})

afterEach(cleanup)

describe('exchangeTelegramAuth', () => {
  it('преобразует id и auth_date виджета в строки и передаёт referral_code', async () => {
    api.apiPost.mockResolvedValue({ accessToken: 'token', user: { id: 'u1' } })

    await exchangeTelegramAuth(
      { id: 42, auth_date: 1690000000, hash: 'HASH1', first_name: 'Иван' },
      'REF9',
    )

    expect(api.apiPost).toHaveBeenCalledWith('/auth/telegram', {
      id: '42',
      auth_date: '1690000000',
      hash: 'HASH1',
      first_name: 'Иван',
      last_name: undefined,
      username: undefined,
      photo_url: undefined,
      referral_code: 'REF9',
    })
  })

  it('без реферального кода referral_code остаётся undefined', async () => {
    api.apiPost.mockResolvedValue({ accessToken: 'token', user: { id: 'u1' } })

    await exchangeTelegramAuth({ id: '42', auth_date: '1690000000', hash: 'HASH1' })

    expect(api.apiPost).toHaveBeenCalledWith('/auth/telegram', {
      id: '42',
      auth_date: '1690000000',
      hash: 'HASH1',
      first_name: undefined,
      last_name: undefined,
      username: undefined,
      photo_url: undefined,
      referral_code: undefined,
    })
  })
})

describe('TelegramLoginWidget', () => {
  it('инжектит скрипт виджета с ботом и колбэком data-onauth', () => {
    render(<TelegramLoginWidget onAuth={() => {}} />)

    const script = screen
      .getByTestId('telegram-widget-slot')
      .querySelector('script[data-telegram-login]')

    expect(script).toBeTruthy()
    expect(script?.getAttribute('src')).toBe('https://telegram.org/js/telegram-widget.js?22')
    expect(script?.getAttribute('data-telegram-login')).toBe('test_bot')
    expect(script?.getAttribute('data-onauth')).toBe('onTelegramWidgetAuth(user)')
  })

  it('не инжектит второй скрипт при повторном эффекте (Strict Mode)', () => {
    // React 18 в dev-сборке монтирует эффекты StrictMode дважды — второй запуск
    // не должен плодить скрипты: контейнер уже занят первым.
    render(
      <StrictMode>
        <TelegramLoginWidget onAuth={() => {}} />
      </StrictMode>,
    )

    expect(screen.getByTestId('telegram-widget-slot').querySelectorAll('script')).toHaveLength(1)
  })

  it('глобальный колбэк виджета доезжает до onAuth', () => {
    const onAuth = vi.fn()
    render(<TelegramLoginWidget onAuth={onAuth} />)

    const globalScope = window as unknown as Record<string, unknown>
    const widgetCallback = globalScope['onTelegramWidgetAuth'] as
      | ((payload: TelegramAuthPayload) => void)
      | undefined
    expect(widgetCallback).toBeTypeOf('function')

    const payload: TelegramAuthPayload = { id: 42, auth_date: 1690000000, hash: 'HASH1' }
    widgetCallback?.(payload)

    expect(onAuth).toHaveBeenCalledWith(payload)
  })
})
