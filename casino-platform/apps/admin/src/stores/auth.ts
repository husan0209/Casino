'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { apiPost } from '@/lib/api'

interface AdminUser { id: string; email: string; role: 'admin' | 'superadmin' }

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
        const res = await apiPost<any>('/admin/auth/login', { email, password })
        if (!res?.accessToken) throw new Error(res?.error?.message || 'Ошибка входа')
        set({ token: res.accessToken, admin: res.admin })
      },
      logout: () => set({ token: null, admin: null }),
    }),
    { name: 'casino-admin-auth' },
  ),
)
