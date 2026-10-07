import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UC-AUTH-09: Telegram Login Widget в redirect-режиме (data-auth-url).
 * - скрипт telegram-widget.js инжектится с ботом из NEXT_PUBLIC_TELEGRAM_BOT_NAME
 *   и auth-url на /auth/telegram/callback;
 * - РЕЖИМ КРИТИЧЕН ДЛЯ CSP: data-onauth виджет компилирует через
 *   Function('user', …) — это eval, запрещённый прод-CSP (P1 #11, EvalError на
 *   проде #203). Спека храповик: data-onauth в DOM не появляется;
 * - telegramPayloadFromQuery разбирает query колбэка: без обязательных
 *   id/auth_date/hash — null, с ними — payload (все поля строками);
 * - exchangeTelegramAuth / previewTelegramAuth шлют ОДИН набор полей: подпись
 *   Telegram считается от них, и разошедшиеся наборы отбивались бы «подпись не
 *   совпадает» на одном из двух шагов;
 * - виджет рисует нашу плашку (как у Google), а iframe лежит поверх прозрачным
 *   слоем: без загрузки скрипта остаётся выключенная плашка, а не мёртвая кнопка.
 */

vi.hoisted(() => {
  process.env['NEXT_PUBLIC_TELEGRAM_BOT_NAME'] = 'test_bot'
})

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

vi.mock('@/lib/api', () => api)

import {
  exchangeTelegramAuth,
  previewTelegramAuth,
  telegramPayloadFromQuery,
  TelegramLoginWidget,
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

describe('previewTelegramAuth', () => {
  /**
   * Проверка подписи (экран подтверждения) и обмен на сессию обязаны отправить
   * один и тот же набор полей: data-check-string строится из них, и если один
   * шаг пришлёт меньше полей, второй отобьётся «подпись Telegram не совпадает».
   */
  it('шлёт те же поля, что и обмен, — разница только в referral_code', async () => {
    const payload = { id: 42, auth_date: 1690000000, hash: 'HASH1', first_name: 'Иван' }

    api.apiPost.mockResolvedValue({
      displayName: 'Иван',
      username: null,
      photoUrl: null,
      accountExists: false,
    })
    await previewTelegramAuth(payload)
    const previewBody = api.apiPost.mock.calls[0]![1] as Record<string, unknown>
    expect(api.apiPost).toHaveBeenCalledWith('/auth/telegram/preview', previewBody)

    api.apiPost.mockResolvedValue({ accessToken: 'token', user: { id: 'u1' } })
    await exchangeTelegramAuth(payload)

    expect(api.apiPost.mock.calls[1]![1]).toStrictEqual({
      ...previewBody,
      referral_code: undefined,
    })
  })
})

describe('telegramPayloadFromQuery', () => {
  it('собирает payload из query колбэка (виджет кладёт поля пользователя строками)', () => {
    const query = new URLSearchParams(
      'id=42&auth_date=1690000000&hash=HASH1&first_name=Иван&photo_url=https%3A%2F%2Ft.me%2Fi.jpg&ref=REF9',
    )

    const payload = telegramPayloadFromQuery(query)

    expect(payload).toEqual({
      id: '42',
      auth_date: '1690000000',
      hash: 'HASH1',
      first_name: 'Иван',
      last_name: undefined,
      username: undefined,
      photo_url: 'https://t.me/i.jpg',
    })
  })

  it('без hash/id/auth_date возвращает null — обмен не начинать', () => {
    expect(telegramPayloadFromQuery(new URLSearchParams('id=42&auth_date=1'))).toBeNull()
    expect(telegramPayloadFromQuery(new URLSearchParams())).toBeNull()
  })
})

describe('TelegramLoginWidget', () => {
  it('инжектит скрипт виджета с ботом и auth-url колбэк-страницей', () => {
    render(<TelegramLoginWidget />)

    const script = screen
      .getByTestId('telegram-widget-slot')
      .querySelector('script[data-telegram-login]')

    expect(script).toBeTruthy()
    expect(script?.getAttribute('src')).toBe('https://telegram.org/js/telegram-widget.js?22')
    expect(script?.getAttribute('data-telegram-login')).toBe('test_bot')
    expect(script?.getAttribute('data-auth-url')).toBe(
      `${window.location.origin}/auth/telegram/callback`,
    )
  })

  /**
   * Виджет наклеивает поля пользователя ровно на data-auth-url и не переносит
   * query страницы (telegram-widget.js: `authUrl = a.href`). Без ?ref= здесь
   * регистрация через Telegram создаёт игрока без реферера — и колбэк не виноват,
   * ему читать нечего.
   */
  it('переносит тихий ?ref= в data-auth-url', () => {
    render(<TelegramLoginWidget referralCode="REF9" />)

    const script = screen
      .getByTestId('telegram-widget-slot')
      .querySelector('script[data-telegram-login]')

    expect(script?.getAttribute('data-auth-url')).toBe(
      `${window.location.origin}/auth/telegram/callback?ref=REF9`,
    )
  })

  it('CSP-храповик: НЕ ставит data-onauth — строковый колбэк виджета требует eval', () => {
    render(<TelegramLoginWidget />)

    const script = screen
      .getByTestId('telegram-widget-slot')
      .querySelector('script[data-telegram-login]')

    expect(script?.hasAttribute('data-onauth')).toBe(false)
  })

  it('не инжектит второй скрипт при повторном эффекте (Strict Mode)', () => {
    // React 18 в dev-сборке монтирует эффекты StrictMode дважды — второй запуск
    // не должен плодить скрипты: контейнер уже занят первым.
    render(
      <StrictMode>
        <TelegramLoginWidget />
      </StrictMode>,
    )

    expect(screen.getByTestId('telegram-widget-slot').querySelectorAll('script')).toHaveLength(1)
  })

  /**
   * Кнопка Telegram по умолчанию имеет фиксированную ширину (238 px), и рядом с
   * растянутой плашкой Google пара выглядит разнородно. Ширину контейнера
   * передаём через data-min-width/data-max-width: на стенде это 229 px → 348 px,
   * проверено замером embed-страницы.
   */
  it('растягивает кнопку на ширину контейнера через data-min-width/data-max-width', () => {
    const observers: Array<(entries: ResizeObserverEntry[]) => void> = []
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn((cb: (entries: ResizeObserverEntry[]) => void) => {
        observers.push(cb)
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
      }),
    )

    render(<TelegramLoginWidget />)
    // До первого замера монтировать рано: иначе кнопка родилась бы в 238 px и
    // осталась бы такой до перемонтирования листа.
    expect(
      screen.getByTestId('telegram-widget-slot').querySelector('script[data-min-width]'),
    ).toBeNull()

    // Колбэк шлёт браузер, не React — без act() перерендер не дождаться.
    act(() => {
      observers[0]?.([{ contentRect: { width: 348 } as DOMRectReadOnly } as ResizeObserverEntry])
    })

    const script = screen
      .getByTestId('telegram-widget-slot')
      .querySelector('script[data-telegram-login]')
    expect(script?.getAttribute('data-min-width')).toBe('348')
    expect(script?.getAttribute('data-max-width')).toBe('348')
    expect(script?.getAttribute('data-radius')).toBe('12')
    // Подпись закрепляем русским: без параметра её диктует язык браузера.
    expect(script?.getAttribute('data-lang')).toBe('ru')
    vi.unstubAllGlobals()
  })

  /**
   * Заливку и подпись кнопки Telegram-embed'а стилизовать нельзя (iframe
   * cross-origin), поэтому видимая часть — наша плашка, а iframe лежит поверх
   * прозрачным слоем: клик, фокус и сама проверка по-прежнему настоящие.
   */
  it('показывает нашу плашку, а iframe виджета — прозрачным слоем поверх неё', () => {
    render(<TelegramLoginWidget />)

    const plate = screen.getByTestId('telegram-widget').querySelector('[aria-hidden="true"]')
    expect(plate?.textContent).toContain('Продолжить с Telegram')

    const slot = screen.getByTestId('telegram-widget-slot')
    expect(slot.className).toContain('absolute')
    expect(slot.className).toContain('opacity-0')
  })

  it('если скрипт виджета не загрузился — выключенная плашка, а не мёртвая кнопка', () => {
    render(<TelegramLoginWidget />)

    act(() => {
      screen
        .getByTestId('telegram-widget-slot')
        .querySelector('script[data-telegram-login]')
        ?.dispatchEvent(new Event('error'))
    })

    const button = screen.getByRole('button', { name: 'Продолжить с Telegram' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId('telegram-widget-slot')).toBeNull()
  })
})
