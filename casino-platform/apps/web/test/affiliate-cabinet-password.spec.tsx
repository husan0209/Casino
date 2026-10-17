import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Восстановление и смена партнёрского пароля (кабинет /affiliate/*).
 *
 * Три вещи, за которыми здесь следит спека:
 *  1. запрос ссылки НЕ различает существующий и несуществующий email — ни по
 *     тексту, ни по тому, что UI делает с ответом сервера (контракт всегда
 *     отдаёт 200 с одной фразой, и форма не имеет права это различать);
 *  2. отказ сброса показывается русской фразой по стабильному КОДУ, а не
 *     техническим сообщением с API;
 *  3. успешная смена пароля гасит локальную сессию — сервер закрывает все
 *     партнёрские токены, и кабинет с мёртвым токеном был бы хуже входа заново.
 *
 * Транспорт мокнем на уровне axios (как auth-store-hydrate.spec.ts), а не на
 * уровне @/lib/affiliate-api: иначе вместе с запросом мокнем и разбор кодов
 * ошибок, который как раз и проверяем.
 */

const httpClient = vi.hoisted(() => ({
  defaults: { headers: { common: {} as Record<string, string> } },
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}))

vi.mock('axios', () => ({ default: { create: (): typeof httpClient => httpClient } }))

const nav = vi.hoisted(() => ({
  search: new URLSearchParams('token=TOKEN-AFF-1'),
  replace: vi.fn(),
  push: vi.fn(),
}))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  useSearchParams: () => nav.search,
  usePathname: () => '/affiliate/settings',
}))
vi.mock('@/components/ui/toaster', () => ({ toast }))

import AffiliateSettingsPage from '@/app/affiliate/(cabinet)/settings/page'
import ForgotPasswordPage from '@/app/affiliate/forgot-password/page'
import AffiliateResetPasswordPage from '@/app/affiliate/reset-password/page'
import { useAffiliateAuth } from '@/stores/affiliate'
import { type AffiliateMeDto } from '@/types/affiliate'

const NEUTRAL_SENT_PHRASE = 'Если такой email есть в партнёрской программе'

const ME: AffiliateMeDto = {
  affiliate_id: 'aff-1',
  email: 'partner@example.com',
  display_name: null,
  status: 'active',
  tracking_code: 'ABC123',
  tracking_url: 'https://example.com/go/ABC123',
  revshare_rate: '0.30',
  revshare_percent: '30',
  payout_currency: 'RUB',
  total_earned: '18420.55',
  balance: { RUB: '1200.00', USDT_TRC20: '0.00' },
  terms_version: 'v1',
  is_agreed: true,
}

/** AxiosError-подобный объект: helpers читают только response.data.error. */
function apiError(code: string | undefined, message: string): unknown {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message,
    response: { status: 401, data: { success: false, error: { code, message } } },
  }
}

const okResponse = (data: unknown): { data: { success: boolean; data: unknown } } => ({
  data: { success: true, data },
})

function renderPage(element: React.JSX.Element): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>)
}

function fillPasswordFields(newPassword: string, repeat: string): void {
  fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: newPassword } })
  fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: repeat } })
}

beforeEach(() => {
  httpClient.get.mockReset()
  httpClient.post.mockReset()
  httpClient.patch.mockReset()
  httpClient.defaults.headers.common = {}
  nav.replace.mockReset()
  nav.push.mockReset()
  nav.search = new URLSearchParams('token=TOKEN-AFF-1')
  toast.success.mockReset()
  toast.error.mockReset()
  useAffiliateAuth.setState({ token: null, affiliateId: null })
  httpClient.get.mockResolvedValue(okResponse(ME))
})

afterEach(() => {
  cleanup()
})

describe('/affiliate/forgot-password', () => {
  it('один нейтральный ответ и для известного, и для неизвестного email', async () => {
    const shown: string[] = []
    // Разные тела успешного ответа: UI обязан их не замечать.
    for (const payload of [{ message: 'If email exists, you will receive a link' }, {}]) {
      httpClient.post.mockResolvedValue(okResponse(payload))
      renderPage(<ForgotPasswordPage />)

      fireEvent.change(screen.getByLabelText('Email партнёрского аккаунта'), {
        target: { value: 'partner@example.com' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Отправить ссылку' }))

      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain(NEUTRAL_SENT_PHRASE),
      )
      shown.push(screen.getByRole('status').textContent)
      cleanup()
    }

    expect(shown[0]).toBe(shown[1])
    // Ни слова о существовании аккаунта: ни «не найден», ни «не существует».
    expect(shown[0] ?? '').not.toMatch(/не найден|не существует|нет такого/i)
  })

  it('запрос уходит на контрактный путь одним полем email', async () => {
    httpClient.post.mockResolvedValue(
      okResponse({ message: 'If email exists, you will receive a link' }),
    )
    renderPage(<ForgotPasswordPage />)

    fireEvent.change(screen.getByLabelText('Email партнёрского аккаунта'), {
      target: { value: '  partner@example.com  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ссылку' }))

    await waitFor(() => expect(httpClient.post).toHaveBeenCalledTimes(1))
    expect(httpClient.post).toHaveBeenCalledWith('/affiliate/auth/forgot-password', {
      email: 'partner@example.com',
    })
  })

  it('сбой сети не притворяется отправленным письмом', async () => {
    httpClient.post.mockRejectedValue(new Error('Network Error'))
    renderPage(<ForgotPasswordPage />)

    fireEvent.change(screen.getByLabelText('Email партнёрского аккаунта'), {
      target: { value: 'partner@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ссылку' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Не удалось отправить запрос'),
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('/affiliate/reset-password', () => {
  it('токен берётся из ?token= и уходит вместе с новым паролем', async () => {
    httpClient.post.mockResolvedValue(okResponse({ ok: true }))
    renderPage(<AffiliateResetPasswordPage />)

    fillPasswordFields('Str0ngPass', 'Str0ngPass')
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    await waitFor(() => expect(httpClient.post).toHaveBeenCalledTimes(1))
    expect(httpClient.post).toHaveBeenCalledWith('/affiliate/auth/reset-password', {
      token: 'TOKEN-AFF-1',
      new_password: 'Str0ngPass',
    })
    expect(toast.success).toHaveBeenCalledWith('Пароль изменён')
    expect(nav.replace).toHaveBeenCalledWith('/affiliate/login')
  })

  it('несовпадение паролей отсекается до запроса — токен одноразовый', () => {
    renderPage(<AffiliateResetPasswordPage />)

    fillPasswordFields('Str0ngPass', 'Str0ngPasx')
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    expect(screen.getByRole('alert').textContent).toBe('Пароли не совпадают')
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('пароль короче 8 символов отсекается до запроса', () => {
    renderPage(<AffiliateResetPasswordPage />)

    fillPasswordFields('a1b2', 'a1b2')
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    expect(screen.getByRole('alert').textContent).toBe('Минимум 8 символов')
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  /** Каждый код контракта — своей русской фразой (lib/ui/affiliate-password). */
  const CODES: Array<[string, string]> = [
    ['AFFILIATE_TOKEN_INVALID', 'Ссылка недействительна. Запросите новую.'],
    ['AFFILIATE_TOKEN_EXPIRED', 'Ссылка протухла — она живёт час. Запросите новую.'],
    ['AFFILIATE_TOKEN_ALREADY_USED', 'Эта ссылка уже использована. Запросите новую.'],
    ['WEAK_PASSWORD', 'Пароль слишком простой: минимум 8 символов.'],
  ]

  for (const [code, expectedText] of CODES) {
    it(`отказ ${code} → «${expectedText}»`, async () => {
      httpClient.post.mockRejectedValue(apiError(code, 'technical message from api'))
      renderPage(<AffiliateResetPasswordPage />)

      fillPasswordFields('Str0ngPass', 'Str0ngPass')
      fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))

      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(expectedText))
    })
  }

  it('VALIDATION_ERROR отдаёт человеческий текст Zod, а не выдуманную фразу', async () => {
    const zodEnvelope = JSON.stringify([{ code: 'too_small', message: 'Минимум 8 символов' }])
    httpClient.post.mockRejectedValue(apiError('VALIDATION_ERROR', zodEnvelope))
    renderPage(<AffiliateResetPasswordPage />)

    fillPasswordFields('Str0ngPass', 'Str0ngPass')
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Минимум 8 символов'))
  })

  it('ссылка без ?token= — форма не показываем, предлагаем новый запрос', () => {
    nav.search = new URLSearchParams('')
    renderPage(<AffiliateResetPasswordPage />)

    expect(screen.getByRole('status').textContent).toContain('В ссылке нет токена')
    expect(screen.queryByLabelText('Новый пароль')).toBeNull()
    expect(screen.getByRole('link', { name: 'Запросить новую ссылку' })).toBeTruthy()
  })
})

describe('смена пароля в кабинете /affiliate/settings', () => {
  beforeEach(() => {
    useAffiliateAuth.getState().setSession('jwt-aff', 'aff-1')
  })

  it('успех гасит локальную сессию и уводит на вход', async () => {
    httpClient.post.mockResolvedValue(okResponse({ ok: true }))
    renderPage(<AffiliateSettingsPage />)
    await screen.findByLabelText('Имя в кабинете')

    expect(httpClient.defaults.headers.common.Authorization).toBe('Bearer jwt-aff')

    fireEvent.change(screen.getByLabelText('Текущий пароль'), { target: { value: 'Old1pass' } })
    fillPasswordFields('New2pass', 'New2pass')
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    await waitFor(() =>
      expect(httpClient.post).toHaveBeenCalledWith('/affiliate/me/password', {
        current_password: 'Old1pass',
        new_password: 'New2pass',
      }),
    )
    expect(useAffiliateAuth.getState().token).toBeNull()
    expect(useAffiliateAuth.getState().affiliateId).toBeNull()
    expect(httpClient.defaults.headers.common.Authorization).toBeUndefined()
    expect(nav.replace).toHaveBeenCalledWith('/affiliate/login')
  })

  it('пустой текущий пароль отсекается до запроса', async () => {
    renderPage(<AffiliateSettingsPage />)
    await screen.findByLabelText('Имя в кабинете')

    fillPasswordFields('New2pass', 'New2pass')
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    expect(screen.getByRole('alert').textContent).toBe('Введите текущий пароль')
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('неверный текущий пароль → русская фраза по коду', async () => {
    httpClient.post.mockRejectedValue(
      apiError('AFFILIATE_PASSWORD_INVALID_CURRENT', 'Invalid current password'),
    )
    renderPage(<AffiliateSettingsPage />)
    await screen.findByLabelText('Имя в кабинете')

    fireEvent.change(screen.getByLabelText('Текущий пароль'), { target: { value: 'Wrong1pass' } })
    fillPasswordFields('New2pass', 'New2pass')
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Текущий пароль указан неверно.'),
    )
    expect(useAffiliateAuth.getState().token).toBe('jwt-aff')
  })
})
