'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiPost, setAccessToken } from '@/lib/api'

type User = { id: string; email: string | null; role: string }
type AuthState = {
  user: User | null
  accessToken: string | null
  setAuth: (user: User, token: string) => void
  logout: () => void
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, referral_code?: string) => Promise<{ message: string }>
}

export const useAuth = create<AuthState>()(persist((set) => ({
  user: null,
  accessToken: null,
  setAuth: (user, token) => { setAccessToken(token); set({ user, accessToken: token }) },
  logout: () => { setAccessToken(null); set({ user: null, accessToken: null }) },
  login: async (email, password) => {
    const res: any = await apiPost('/auth/login', { email, password })
    const token = res.accessToken
    const user = res.user
    setAccessToken(token)
    set({ user, accessToken: token })
  },
  register: async (email, password, referral_code) => {
    return await apiPost('/auth/register', { email, password, referral_code })
  },
}), { name: 'auth', partialize: s => ({ user: s.user, accessToken: s.accessToken }), onRehydrateStorage: () => (state) => { if (state?.accessToken) setAccessToken(state.accessToken) } }))
