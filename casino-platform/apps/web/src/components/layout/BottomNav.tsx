'use client'

import { Gamepad2, Heart, Home, User } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { UserAvatar } from '@/components/layout/UserAvatar'
import { useFavorites } from '@/hooks/useFavorites'
import { useAuth } from '@/stores/auth'

/**
 * GAP-52 (ТЗ ч.5 §4.3) + визуал ТЗ ч.5.1 §2 пр.7–8: таббар —
 * Главная · Казино · Избранное · Профиль. «Избранное» — полным словом
 * (Don't-лист §6 запрещает «Избр.»), иконки — lucide, у залогиненного
 * в «Профиле» — реальная аватарка. Кошелька в таб-баре нет: деньги
 * живут в шапке (§2 пр.6).
 */
export function BottomNav(): React.JSX.Element | null {
  const pathname = usePathname()
  const { user } = useAuth()
  const { favoriteSlugs } = useFavorites()
  const favCount = favoriteSlugs.size

  if (pathname.startsWith('/login') || pathname.startsWith('/register')) {
    return null
  }

  const items = [
    { href: '/', label: 'Главная', Icon: Home },
    { href: '/casino', label: 'Казино', Icon: Gamepad2 },
    { href: '/favorites', label: 'Избранное', Icon: Heart },
  ]

  const linkClass = (active: boolean): string =>
    `flex flex-col items-center gap-0.5 py-1 text-[11px] font-medium transition-colors ${
      active ? 'text-[#6C63FF]' : 'text-muted hover:text-white'
    }`

  const isActive = (href: string): boolean =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#2A2A4A]/60 bg-[#0F0F1A]/95 backdrop-blur md:hidden">
      <div className="grid grid-cols-4 py-2 text-center text-[11px]">
        {items.map((item) => {
          const isFav = item.href === '/favorites'
          return (
            <Link key={item.href} href={item.href} className={linkClass(isActive(item.href))}>
              <div className="relative">
                <item.Icon size={22} strokeWidth={1.8} aria-hidden />
                {isFav && favCount > 0 && (
                  <span className="absolute -right-2 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-[#6C63FF] px-1 text-[9px] font-bold text-white shadow-sm">
                    {favCount}
                  </span>
                )}
              </div>
              <span>{item.label}</span>
            </Link>
          )
        })}
        <Link href="/profile" className={linkClass(isActive('/profile'))}>
          {user ? (
            <UserAvatar email={user.email} size={22} />
          ) : (
            <User size={22} strokeWidth={1.8} aria-hidden />
          )}
          <span>Профиль</span>
        </Link>
      </div>
    </nav>
  )
}
