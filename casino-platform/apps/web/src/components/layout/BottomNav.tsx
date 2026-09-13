'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * GAP-52 (ТЗ ч.5 §4.3): таббар — Главная · Казино · Избранное · Профиль.
 * Кошелёк не ставим: он в шапке (правило «деньги в одном месте»).
 */
const items = [
  { href: '/', label: 'Главная' },
  { href: '/casino', label: 'Казино' },
  { href: '/favorites', label: 'Избр.' },
  { href: '/profile', label: 'Профиль' },
]

export function BottomNav(): React.JSX.Element | null {
  const pathname = usePathname()
  if (pathname.startsWith('/login') || pathname.startsWith('/register')) {
    return null
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#2A2A4A] bg-[#0F0F1A]/95 backdrop-blur md:hidden">
      <div className="grid grid-cols-4 py-2 text-center text-xs">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href} className={active ? 'text-white' : 'text-muted'}>
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
