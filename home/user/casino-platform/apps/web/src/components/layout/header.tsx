'use client'
import Link from 'next/link'
import { useAuth } from '@/stores/auth'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'

export function Header() {
  const { user, logout } = useAuth()
  const { data: balances } = useQuery({
    queryKey: ['wallet','balances'],
    queryFn: () => apiGet<any[]>('/wallet/balances'),
    enabled: !!user,
    refetchInterval: 15000,
  })
  const rub = balances?.find((b:any) => b.currency === 'RUB')
  return (
    <header className="border-b border-white/5 bg-surface/70 backdrop-blur sticky top-0 z-40">
      <div className="container-1 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-black text-lg tracking-tight">CASINO<span className="text-brand">.</span></Link>
          <nav className="hidden md:flex gap-5 text-sm text-muted">
            <Link href="/casino" className="hover:text-white">Казино</Link>
            <Link href="/support" className="hover:text-white">Поддержка</Link>
            <Link href="/referral" className="hover:text-white">Рефералы</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link href="/wallet" className="text-sm px-3 py-1.5 rounded-lg bg-surface2 border border-white/10 hover:border-brand/40">
                {rub ? `${Number(rub.available).toFixed(2)} ₽` : '0 ₽'}
              </Link>
              <Link href="/profile" className="text-sm text-muted hover:text-white">{user.email || 'Профиль'}</Link>
              <button onClick={logout} className="text-sm text-muted hover:text-white">Выйти</button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost text-sm">Вход</Link>
              <Link href="/register" className="btn text-sm">Регистрация</Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
