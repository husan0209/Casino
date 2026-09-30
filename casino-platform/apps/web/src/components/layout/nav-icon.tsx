'use client'

import {
  Clock,
  Gamepad2,
  Handshake,
  Heart,
  Home,
  MessageCircle,
  Puzzle,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

/**
 * Ключ иконки навигации → компонент lucide. Ключи живут в NAV_ITEMS
 * (lib/ui/desktop-nav.ts — чистые данные), маппинг здесь, чтобы либ-модуль
 * не зависел от React-компонент. Эмодзи в навигации запрещены (ТЗ ч.5.1 §6).
 */
const NAV_ICONS: Record<string, LucideIcon> = {
  home: Home,
  casino: Gamepad2,
  heart: Heart,
  puzzle: Puzzle,
  wallet: Wallet,
  history: Clock,
  chat: MessageCircle,
  handshake: Handshake,
}

export function NavIcon({ icon, size = 20 }: { icon: string; size?: number }): React.JSX.Element {
  const Component = NAV_ICONS[icon] ?? Home
  return <Component size={size} strokeWidth={1.8} aria-hidden />
}
