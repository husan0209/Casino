'use client'

import { History, LogOut, Settings, User, Wallet } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { UserAvatar } from '@/components/layout/UserAvatar'
import { useAuth } from '@/stores/auth'

/**
 * ТЗ ч.5.1 §2 пр.9: тап по аватарке → dropdown-меню.
 * Пункты: Профиль · Мои кошельки · История ставок · Настройки · Выйти.
 * Пр.9 называет пункт «История игр», но §5.3 и ч.5 §12 зовут тот же экран
 * «История ставок» — оставил название самого экрана, чтобы пункт не врал.
 * KYC-пункт — только если статус блокирует вывод/лимит (не в MVP).
 */

interface MenuItem {
  href: string
  label: string
  icon: React.ReactNode
}

const MENU_ITEMS: MenuItem[] = [
  { href: '/profile', label: 'Профиль', icon: <User size={16} aria-hidden /> },
  { href: '/wallet', label: 'Мои кошельки', icon: <Wallet size={16} aria-hidden /> },
  { href: '/history', label: 'История ставок', icon: <History size={16} aria-hidden /> },
  { href: '/profile?tab=settings', label: 'Настройки', icon: <Settings size={16} aria-hidden /> },
]

export function UserMenu({
  email,
  avatarUrl = null,
}: {
  email: string | null
  avatarUrl?: string | null
}): React.JSX.Element {
  const { logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Закрываем по клику вне меню
  useEffect(() => {
    if (!open) {
      return
    }
    const handler = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Закрываем по Escape
  useEffect(() => {
    if (!open) {
      return
    }
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const displayName = email ? email.split('@')[0] : 'Игрок'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Меню пользователя"
        aria-expanded={open}
        className="shrink-0 rounded-full transition hover:ring-2 hover:ring-brand/40"
      >
        <UserAvatar email={email} avatarUrl={avatarUrl} size={34} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-[#2A2A4A]/60 bg-[#1A1A2E] shadow-xl shadow-black/30">
          {/* User info */}
          <div className="flex items-center gap-3 border-b border-[#2A2A4A]/40 px-4 py-3">
            <UserAvatar email={email} avatarUrl={avatarUrl} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{displayName}</div>
              <div className="truncate text-xs text-muted">{email}</div>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {MENU_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/5 hover:text-white"
              >
                <span className="text-muted">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>

          {/* Logout */}
          <div className="border-t border-[#2A2A4A]/40 py-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                logout()
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[#FF3D71] transition hover:bg-[#FF3D71]/10"
            >
              <LogOut size={16} aria-hidden />
              Выйти
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
