'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { formatBalance } from '@/lib/format/currency'
import { searchHref } from '@/lib/ui/desktop-nav'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

/**
 * GAP-54 (ТЗ ч.5 §4.2/§4.4/§4.5): sticky-хедер.
 * - деньги всегда на одном месте: активный баланс + зелёная «Пополнить»;
 * - десктоп: поле глобального поиска в хедере (Enter/кнопка → /search?q=,
 *   Ctrl/⌘K — обработчик в MainShell);
 * - телефон: вход в поиск — лупа рядом с действиями (полноценное поле под
 *   шапкой на главной, §4.4).
 */
export function AppHeader(): React.JSX.Element {
  const { user } = useAuth()
  const { activeCurrency, getActiveWallet, fetchWallets } = useWalletStore()
  const { config, load } = useGeoStore()
  const { openDeposit, openLogin, openWalletSwitcher } = useUIStore()
  const router = useRouter()
  const [query, setQuery] = useState('')

  useEffect(() => {
    void load()
    if (user) {
      void fetchWallets()
    }
  }, [user, load, fetchWallets])

  const wallet = getActiveWallet()
  const displayCurrency = config?.activeCurrency ?? activeCurrency
  const balance = wallet?.available ?? '0'

  const submitSearch = (event: React.FormEvent): void => {
    event.preventDefault()
    router.push(searchHref(query))
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[#2A2A4A] bg-[#0F0F1A]/95 backdrop-blur">
      <div className="container-1 flex h-14 items-center gap-3">
        <Link href="/" className="shrink-0 font-bold tracking-tight">
          Casino
        </Link>

        <form onSubmit={submitSearch} className="hidden max-w-md flex-1 md:block">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск игр и провайдеров…"
            aria-label="Поиск"
            className="input"
          />
        </form>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/search"
            aria-label="Поиск"
            className="rounded-lg px-2 py-1 text-base hover:bg-white/5 md:hidden"
          >
            🔍
          </Link>

          {user ? (
            <>
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
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </header>
  )
}
