'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { apiPost } from '@/lib/api'

interface AdminUser {
  id: string
  email: string
  role: 'admin' | 'superadmin'
}

/** Ответ /admin/auth/login: {accessToken, admin} без обёртки data. */
interface AdminLoginResponse {
  accessToken: string
  admin: AdminUser
}

interface AuthState {
  token: string | null
  admin: AdminUser | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      login: async (email, password) => {
        // /admin/auth/login возвращает {accessToken, admin} – без обёртки data
        const res = await apiPost<AdminLoginResponse>('/admin/auth/login', { email, password })
        if (!res?.accessToken || !res?.admin) {
          throw new Error('Ошибка входа')
        }
        set({ token: res.accessToken, admin: res.admin })
      },
      logout: () => set({ token: null, admin: null }),
    }),
    { name: 'casino-admin-auth' },
  ),
)
