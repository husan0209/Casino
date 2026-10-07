import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Смена пароля в профиле (GAP-52). Повтор нового пароля здесь нужен по той же
 * причине, что и на сбросе: текущий пароль игрок знает, а новый набрал вслепую —
 * опечатка означает «доступ к кошельку потерян», и обнаружится это только при
 * следующем входе. Тело запроса при этом остаётся двухполем: схема эндпоинта
 * `.strict()`, и третье поле в него попасть не должно.
 */

const change = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@/lib/api/users.api', () => ({
  changePassword: change,
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  revokeAllSessions: vi.fn(),
  revokeSession: vi.fn(),
  updateSettings: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ errCode: () => undefined, errText: () => 'Ошибка' }))
vi.mock('@/components/ui/toaster', () => ({ toast }))

import { SecurityTab } from '@/components/profile/ProfileTabs'

const ME = {
  user: {
    id: 'u1',
    email: 'player@example.com',
    status: 'active',
    role: 'user',
    referralCode: 'REF1',
    createdAt: '2026-01-01',
    hasPassword: true,
  },
  profile: null,
  settings: { notificationsEmail: false, notificationsPush: false },
  sessions: [],
} as never

const renderTab = (): void => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SecurityTab me={ME} onLogout={() => {}} />
    </QueryClientProvider>,
  )
}

const submit = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /Сменить пароль/ }) as HTMLButtonElement

beforeEach(() => {
  change.mockReset()
  toast.success.mockReset()
})

afterEach(cleanup)

describe('смена пароля в профиле', () => {
  it('поле повтора есть, и без него кнопка неактивна', () => {
    renderTab()

    expect(screen.getByPlaceholderText('Повторите новый пароль')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Текущий пароль'), {
      target: { value: 'Old1pass' },
    })
    fireEvent.change(screen.getByPlaceholderText('Новый пароль (мин. 8 симв., 1 цифра)'), {
      target: { value: 'New2pass' },
    })

    expect(submit().disabled).toBe(true)
  })

  it('несовпадение — ошибка под полем, запрос не уходит', () => {
    renderTab()
    fireEvent.change(screen.getByPlaceholderText('Текущий пароль'), {
      target: { value: 'Old1pass' },
    })
    fireEvent.change(screen.getByPlaceholderText('Новый пароль (мин. 8 симв., 1 цифра)'), {
      target: { value: 'New2pass' },
    })
    fireEvent.change(screen.getByPlaceholderText('Повторите новый пароль'), {
      target: { value: 'New2pasx' },
    })

    expect(screen.getByRole('alert').textContent).toBe('Пароли не совпадают')
    expect(submit().disabled).toBe(true)
    expect(change).not.toHaveBeenCalled()
  })

  it('совпавший пароль отправляется ровно двумя полями — схема .strict()', async () => {
    change.mockResolvedValue({ ok: true })
    renderTab()
    fireEvent.change(screen.getByPlaceholderText('Текущий пароль'), {
      target: { value: 'Old1pass' },
    })
    fireEvent.change(screen.getByPlaceholderText('Новый пароль (мин. 8 симв., 1 цифра)'), {
      target: { value: 'New2pass' },
    })
    fireEvent.change(screen.getByPlaceholderText('Повторите новый пароль'), {
      target: { value: 'New2pass' },
    })

    expect(submit().disabled).toBe(false)
    fireEvent.click(submit())

    // useMutation разворачивает запрос асинхронно, поэтому ждём, а не проверяем
    // по стрелке: синхронно после клика spy ещё пустой.
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        current_password: 'Old1pass',
        new_password: 'New2pass',
      }),
    )
  })
})
