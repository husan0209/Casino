/**
 * Аудит контрактов 2026-09-26: hydrate() против GET /users/me.
 *
 * API (GetMeUseCase -> UserProfileFull) отдаёт {user, profile, settings,
 * kycStatus} внутри конверта {success, data} — пользователем для store является
 * только поле user. Регресс, который ловит спека: если в set({user}) уходит
 * весь MeDto, у «пользователя» после перезагрузки страницы нет id/email/role
 * (тихий дефект — Boolean(user) остаётся true, страницы рендерятся с пустыми
 * полями).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedApi = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}

vi.mock('axios', () => ({ default: { create: () => mockedApi } }))

const { useAuth } = await import('../src/stores/auth')

const meDto = {
  user: {
    id: 'u1',
    email: 'player@example.com',
    status: 'active',
    role: 'user',
    referralCode: 'REF12',
    createdAt: '2026-01-01T00:00:00.000Z',
    hasPassword: true,
  },
  profile: null,
  settings: null,
  kycStatus: 'not_started',
}

beforeEach(() => {
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
  useAuth.setState({ token: null, user: null, hydrated: false })
})

describe('аудит 2026-09-26: hydrate() разворачивает {user, ...} из /users/me', () => {
  it('после reload user = поле user из MeDto (id/email/role на месте)', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { accessToken: 'jwt-2' } } })
    mockedApi.get.mockResolvedValue({ data: { data: meDto } })

    await useAuth.getState().hydrate()

    expect(useAuth.getState().token).toBe('jwt-2')
    const user = useAuth.getState().user
    expect(user?.id).toBe('u1')
    expect(user?.email).toBe('player@example.com')
    expect(user?.role).toBe('user')
  })

  it('профиль/настройки не уносятся в user (это не поля WebUser)', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { accessToken: 'jwt-3' } } })
    mockedApi.get.mockResolvedValue({
      data: { data: { ...meDto, profile: { avatarUrl: '/a.png' } } },
    })

    await useAuth.getState().hydrate()

    const user = useAuth.getState().user as Record<string, unknown> | null
    expect(user).not.toHaveProperty('profile')
    expect(user).not.toHaveProperty('kycStatus')
  })

  it('отказ /users/me после успешного refresh сбрасывает сессию (как раньше)', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { accessToken: 'jwt-4' } } })
    mockedApi.get.mockRejectedValue(new Error('boom'))

    await useAuth.getState().hydrate()

    expect(useAuth.getState().token).toBeNull()
    expect(useAuth.getState().user).toBeNull()
    expect(useAuth.getState().hydrated).toBe(true)
  })
})
