'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { LoginSheet } from '@/components/auth/LoginSheet'
import { AppHeader } from '@/components/layout/AppHeader'
import { BottomNav } from '@/components/layout/BottomNav'
import { DesktopNav } from '@/components/layout/DesktopNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DepositReturnHandler } from '@/components/wallet/DepositReturnHandler'
import { DepositSheet } from '@/components/wallet/DepositSheet'
import { LaunchCurrencySheet } from '@/components/wallet/LaunchCurrencySheet'
import { WalletSwitcher } from '@/components/wallet/WalletSwitcher'
import { WithdrawSheet } from '@/components/wallet/WithdrawSheet'
import { isAuthPath, isSearchShortcut } from '@/lib/ui/desktop-nav'

/** §4.5: состояние pin панели переживает reload. */
const PIN_KEY = 'casino-web-nav-pinned'

/**
 * GAP-54 (ТЗ ч.5 §4.1/§4.5/§4.7/§16): каркас приложения.
 * - телефон: header + content + footer + bottom nav;
 * - десктоп: слева икон-панель (pin — шире, контент смещается), поиск в хедере,
 *   Ctrl/⌘K ведёт на /search;
 * - страницы аутентификации (§4.7) — без казино-навигации, листы кассы/логина
 *   остаются смонтированными (после входа launch продолжается, §5.5).
 */
export function MainShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    try {
      setPinned(window.localStorage.getItem(PIN_KEY) === '1')
    } catch {
      /* приватный режим — оставляем свёрнутой */
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isSearchShortcut(event)) {
        return
      }
      event.preventDefault()
      router.push('/search')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [router])

  const togglePin = (): void => {
    const next = !pinned
    setPinned(next)
    try {
      window.localStorage.setItem(PIN_KEY, next ? '1' : '0')
    } catch {
      /* приватный режим — не критично */
    }
  }

  // §4.7: путь берём из usePathname (не window.location!) — иначе hydration
  // mismatch на серверном рендере и нерелевантность при SPA-переходах.
  const bare = isAuthPath(pathname)

  if (bare) {
    return (
      <>
        <main className="min-h-screen">{children}</main>
        <LoginSheet />
        <DepositSheet />
        <WithdrawSheet />
        <WalletSwitcher />
        <LaunchCurrencySheet />
        <DepositReturnHandler />
      </>
    )
  }

  return (
    <>
      <DesktopNav pinned={pinned} onTogglePin={togglePin} />
      <div
        className={`flex min-h-screen flex-col transition-[padding] ${
          pinned ? 'md:pl-[200px]' : 'md:pl-16'
        }`}
      >
        <AppHeader />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
        <SiteFooter />
      </div>
      <BottomNav />
      <LoginSheet />
      <DepositSheet />
      <WithdrawSheet />
      <WalletSwitcher />
      <LaunchCurrencySheet />
      <DepositReturnHandler />
    </>
  )
}
