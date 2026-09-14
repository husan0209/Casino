'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { isNavActive, NAV_ITEMS } from '@/lib/ui/desktop-nav'

/**
 * GAP-54 (ТЗ ч.5 §4.5): десктоп-панель — узкая икон-панель 64px, подписи
 * по hover (тултип) и по pin (раскрытие до 200px, состояние хранит MainShell).
 * На телефоне не показываем: там BottomNav (§4.3).
 */
export function DesktopNav({
  pinned,
  onTogglePin,
}: {
  pinned: boolean
  onTogglePin: () => void
}): React.JSX.Element {
  const pathname = usePathname()

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-[#2A2A4A] bg-[#0F0F1A] py-3 transition-[width] md:flex ${
        pinned ? 'w-[200px]' : 'w-16'
      }`}
    >
      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isNavActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group relative mx-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/5 ${
                active ? 'bg-[#6C63FF]/15 text-white' : 'text-muted'
              }`}
            >
              <span className="w-5 shrink-0 text-center text-base" aria-hidden>
                {item.icon}
              </span>
              {pinned && <span className="truncate">{item.label}</span>}
              {/* подпись по hover, когда панель свёрнута (§4.5) */}
              {!pinned && (
                <span className="pointer-events-none absolute left-full top-1/2 z-40 hidden -translate-y-1/2 whitespace-nowrap rounded-lg border border-[#2A2A4A] bg-[#1A1A2E] px-2 py-1 text-xs text-white group-hover:block">
                  {item.label}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      <button
        type="button"
        onClick={onTogglePin}
        aria-label={pinned ? 'Свернуть меню' : 'Закрепить меню'}
        className="mx-2 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs text-muted hover:bg-white/5"
      >
        <span aria-hidden>{pinned ? '«' : '»'}</span>
        {pinned && <span className="truncate">Свернуть</span>}
      </button>
    </aside>
  )
}
