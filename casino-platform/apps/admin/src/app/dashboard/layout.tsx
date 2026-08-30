'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useAuthStore } from '@/stores/auth'

const nav: Array<[string, string]> = [
  ['Дашборд', '/dashboard'],
  ['Пользователи', '/dashboard/users'],
  ['Транзакции', '/dashboard/transactions'],
  ['Платежи', '/dashboard/payments'],
  ['Выводы', '/dashboard/withdrawals'],
  ['KYC', '/dashboard/kyc'],
  ['Игры', '/dashboard/games'],
  ['Провайдеры', '/dashboard/providers'],
  ['Поддержка', '/dashboard/support'],
  ['Рефералы', '/dashboard/referrals'],
  ['Аудит', '/dashboard/audit'],
  ['Админы', '/dashboard/admins'],
  ['Настройки', '/dashboard/settings'],
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const token = useAuthStore((s) => s.token)
  const admin = useAuthStore((s) => s.admin)
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    if (!token) {
      router.replace('/')
    }
  }, [token, router])

  if (!token) {
    return null
  }

  return (
    <div className="min-h-screen bg-[#0b0b12] text-white">
      <header className="h-14 border-b border-white/10 bg-[#141420] flex items-center px-4 justify-between">
        <div className="font-bold">
          ADMIN<span className="text-[#ff3b7a]">.</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-[#8b8ba7]">
          <span>
            {admin?.email ?? 'admin'}{' '}
            <span className="text-[10px] uppercase text-[#ff3b7a]">{admin?.role}</span>
          </span>
          <button
            onClick={() => {
              logout()
              router.replace('/')
            }}
            className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5"
          >
            Выйти
          </button>
        </div>
      </header>
      <div className="flex">
        <aside className="w-60 border-r border-white/10 min-h-[calc(100vh-56px)] p-3">
          <nav className="space-y-1 text-sm">
            {nav.map(([label, href]) => (
              <Link key={href} href={href} className="block px-3 py-2 rounded-lg hover:bg-white/5">
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
