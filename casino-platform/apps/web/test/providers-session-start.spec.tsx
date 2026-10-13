import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/providers'

/**
 * Порядок старта сессии (`apps/web/src/app/providers.tsx`): подписанный initData
 * из Telegram → гидрация гостя → Google One Tap.
 *
 * Второй вывод, ради которого этот файл нужен: отказ дополнительного пути входа
 * не показывается игроку ни тостом, ни ошибкой. One Tap и Mini App — пути «если
 * получается»; их провал не имеет права выглядеть как поломка сайта, поэтому
 * экран входа остаётся обычным.
 */

const m = vi.hoisted(() => {
  const order: string[] = []
  return {
    order,
    handshake: vi.fn(async (): Promise<boolean> => {
      order.push('telegram')
      return false
    }),
    oneTap: vi.fn(async (): Promise<boolean> => {
      order.push('one-tap')
      return true
    }),
    hydrate: vi.fn(async (): Promise<void> => {
      order.push('hydrate')
    }),
    success: vi.fn(),
    error: vi.fn(),
    interceptors: vi.fn(),
  }
})

vi.mock('@/lib/telegram-webapp-auth', () => ({ handshakeTelegramWebApp: m.handshake }))
vi.mock('@/lib/google-one-tap', () => ({ startGoogleOneTap: m.oneTap }))
vi.mock('@/lib/api-interceptors', () => ({ setupApiInterceptors: m.interceptors }))
vi.mock('@/components/ui/toaster', () => ({ toast: { success: m.success, error: m.error } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: { getState: () => ({ hydrate: m.hydrate }) } }))

beforeEach(() => {
  m.order.length = 0
  m.handshake.mockReset()
  m.oneTap.mockReset()
  m.hydrate.mockReset()
  m.success.mockReset()
  m.error.mockReset()
  m.handshake.mockImplementation(async (): Promise<boolean> => {
    m.order.push('telegram')
    return false
  })
  m.oneTap.mockImplementation(async (): Promise<boolean> => {
    m.order.push('one-tap')
    return true
  })
  m.hydrate.mockImplementation(async (): Promise<void> => {
    m.order.push('hydrate')
  })
})

afterEach(() => {
  cleanup()
})

describe('Providers: старт сессии', () => {
  it('гость: Telegram → гидрация → One Tap, вошедшего отмечают тостом', async () => {
    render(
      <Providers>
        <span>child</span>
      </Providers>,
    )

    await waitFor((): void => expect(m.success).toHaveBeenCalledWith('Вы вошли через Google'))
    expect(m.order).toEqual(['telegram', 'hydrate', 'one-tap'])
  })

  it('One Tap не сработал: тоста нет — провал дополнительного пути не показывается', async () => {
    m.oneTap.mockImplementation(async (): Promise<boolean> => {
      m.order.push('one-tap')
      return false
    })

    render(
      <Providers>
        <span>child</span>
      </Providers>,
    )

    await waitFor((): void => expect(m.order).toEqual(['telegram', 'hydrate', 'one-tap']))
    expect(m.success).not.toHaveBeenCalled()
    expect(m.error).not.toHaveBeenCalled()
  })

  it('вход из Mini App: гидрация не нужна, One Tap вызывается и сам отказывается', async () => {
    m.handshake.mockImplementation(async (): Promise<boolean> => {
      m.order.push('telegram')
      return true
    })
    // Рабочую сессию видит сам модуль One Tap ( stores/auth ), поэтому здесь он
    // обязан дать false — провайдер второго входа не устраивает.
    m.oneTap.mockImplementation(async (): Promise<boolean> => {
      m.order.push('one-tap')
      return false
    })

    render(
      <Providers>
        <span>child</span>
      </Providers>,
    )

    await waitFor((): void => expect(m.order).toEqual(['telegram', 'one-tap']))
    expect(m.hydrate).not.toHaveBeenCalled()
    expect(m.success).not.toHaveBeenCalled()
  })

  it('отказ One Tap исключением: экран не ломается, тоста нет', async () => {
    m.oneTap.mockImplementation(async (): Promise<boolean> => {
      m.order.push('one-tap')
      throw new Error('nonce не получен')
    })

    render(
      <Providers>
        <span>child</span>
      </Providers>,
    )

    await waitFor((): void => expect(m.order).toEqual(['telegram', 'hydrate', 'one-tap']))
    expect(m.success).not.toHaveBeenCalled()
    expect(m.error).not.toHaveBeenCalled()
  })
})
