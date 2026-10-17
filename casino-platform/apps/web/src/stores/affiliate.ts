'use client'
import { create } from 'zustand'

import { affiliateErrText, affiliatePost, setAffiliateToken } from '@/lib/affiliate-api'
import { type AffiliateAuthDto } from '@/types/affiliate'

/**
 * Сессия партнёра.
 *
 * Отдельный store от `useAuth` (игрока) намеренно: это разные аккаунты с
 * разными токенами. Человек может быть одновременно игроком сайта и партнёром
 * программы, и смешивать их состояние нельзя.
 *
 * Токен хранится в памяти (как у игрока): localStorage — XSS-мишень. Поэтому
 * после перезагрузки страницы партнёру нужно войти заново — это осознанный
 * компромисс MVP, отмеченный в ТЗ ч.8 §10.1.
 */
export interface AffiliateAuthState {
  token: string | null
  affiliateId: string | null
  hydrated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (input: {
    email: string
    password: string
    displayName?: string | undefined
    website?: string | undefined
    telegram?: string | undefined
  }) => Promise<AffiliateAuthDto>
  /**
   * Запрос ссылки на восстановление. Успешен всегда: сервер не различает
   * известный и неизвестный email (анти-перебор), поэтому и здесь ветвления нет.
   */
  forgotPassword: (email: string) => Promise<void>
  resetPassword: (token: string, newPassword: string) => Promise<void>
  /** Смена пароля внутри сессии: после успеха сессия локально гасится. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  logout: () => void
  setSession: (token: string, affiliateId: string) => void
}

export const useAffiliateAuth = create<AffiliateAuthState>()((set, get) => ({
  token: null,
  affiliateId: null,
  hydrated: true,
  login: async (email, password) => {
    const res = await affiliatePost<AffiliateAuthDto>('/affiliate/login', { email, password })
    setAffiliateToken(res.access_token)
    set({ token: res.access_token, affiliateId: res.affiliate_id })
  },
  register: async (input) => {
    const res = await affiliatePost<AffiliateAuthDto>('/affiliate/register', {
      email: input.email,
      password: input.password,
      display_name: input.displayName,
      website: input.website,
      telegram: input.telegram,
      // Согласие — обязательное условие регистрации (compliance, ТЗ ч.8 §14.1).
      accept_terms: true,
    })
    setAffiliateToken(res.access_token)
    set({ token: res.access_token, affiliateId: res.affiliate_id })
    return res
  },
  forgotPassword: async (email) => {
    // Ответ всегда 200 и всегда одна и та же фраза — в том числе когда такого
    // партнёрского email нет. Различия здесь намеренно нет: любая ветка
    // «не нашли» вернула бы обратно канал перебора аккаунтов, который закрыт
    // на сервере (партнёрские креды живут в таблице affiliates, их не видно
    // через игровую форму сброса).
    await affiliatePost<unknown>('/affiliate/auth/forgot-password', { email })
  },
  resetPassword: async (token, newPassword) => {
    // Пароль — строка: уходит как есть, без нормализации и без приведений типов.
    await affiliatePost<unknown>('/affiliate/auth/reset-password', {
      token,
      new_password: newPassword,
    })
  },
  changePassword: async (currentPassword, newPassword) => {
    await affiliatePost<unknown>('/affiliate/me/password', {
      current_password: currentPassword,
      new_password: newPassword,
    })
    // Сервер при смене пароля отзывает ВСЕ сессии партнёра. Локальную гасим
    // здесь, а не на странице: иначе любой следующий вызов этой операции
    // оставил бы кабинет работать мёртвым токеном до первого 401.
    get().logout()
  },
  logout: () => {
    setAffiliateToken('')
    set({ token: null, affiliateId: null })
  },
  setSession: (token, affiliateId) => {
    setAffiliateToken(token)
    set({ token, affiliateId })
  },
}))

export { affiliateErrText }
