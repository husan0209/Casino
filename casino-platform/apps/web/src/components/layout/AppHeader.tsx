'use client'
import Link from 'next/link'
import { useEffect } from 'react'

import { formatBalance } from '@/lib/format/currency'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

export function AppHeader(): React.JSX.Element {
  const { user } = useAuth()
  const { activeCurrency, getActiveWallet, fetchWallets } = useWalletStore()
  const { config, load } = useGeoStore()
  const { openDeposit, openLogin, openWalletSwitcher } = useUIStore()

  useEffect(() => {
    void load()
    if (user) {
      void fetchWallets()
    }
  }, [user, load, fetchWallets])

  const wallet = getActiveWallet()
  const displayCurrency = config?.activeCurrency || activeCurrency
  const balance = wallet?.available ?? '0'

  return (
    <header className="sticky top-0 z-30 border-b border-[#2A2A4A] bg-[#0F0F1A]/95 backdrop-blur">
      <div className="container-1 flex h-14 items-center justify-between gap-3">
        <Link href="/" className="font-bold tracking-tight">
          Casino
        </Link>

        {user ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openWalletSwitcher}
              className="rounded-lg px-2 py-1 text-sm font-medium hover:bg-white/5"
            >
              {formatBalance(balance, displayCurrency)} ▾
            </button>
            <button
              type="button"
              className="btn-money px-3 py-1.5 text-sm"
              onClick={() => openDeposit(displayCurrency)}
            >
              Пополнить
            </button>
            <Link
              href="/profile"
              className="rounded-full bg-[#16213E] px-2.5 py-1 text-xs text-muted"
            >
              👤
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost px-3 py-1.5 text-sm"
              onClick={() => openLogin()}
            >
              Войти
            </button>
            <Link href="/register" className="btn px-3 py-1.5 text-sm">
              Регистрация
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}
