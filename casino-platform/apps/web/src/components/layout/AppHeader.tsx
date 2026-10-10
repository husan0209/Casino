'use client'

import { ChevronDown, Plus, Search } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Logo } from '@/components/layout/Logo'
import { UserMenu } from '@/components/layout/UserMenu'
import { formatBalance } from '@/lib/format/currency'
import { searchHref } from '@/lib/ui/desktop-nav'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

/**
 * GAP-54 (ТЗ ч.5 §4.2/§4.4/§4.5) + визуал ТЗ ч.5.1 §4.1: sticky-хедер.
 * - гость: лого · «Войти» · акцентная «Регистрация» (header B);
 * - свой: лого · pill-баланс с шевроном (WalletSwitcher) · зелёная «+» ·
 *   аватарка — деньги всегда в одном месте (§2 пр.6);
 * - поиск: десктоп — поле в хедере, телефон — лупа (Ctrl/⌘K — в MainShell).
 * Эмодзи-иконки заменены на lucide (Don't-лист §6).
 * Адаптация: на экранах <400px кнопки компактнее, поиск уже, у лого без
 * вордмарка — сумма ширин не должна вылезать за экран (жалоба на мал. смартфоны).
 */
export function AppHeader(): React.JSX.Element {
  const { user } = useAuth()
  const { activeCurrency, getActiveWallet, fetchWallets } = useWalletStore()
  const { load } = useGeoStore()
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
  // Число берём из активного кошелька — им и подписываем. `config.activeCurrency`
  // на бэке типизирован как FiatCurrency (geo-config.policy.ts:29) и криптой быть
  // не может, поэтому 84.20 USDT подписывались рублями, а 3 200 ₴ — рублями до
  // перезагрузки гео-конфига. Автоконвертации по ТЗ нет (Don't-лист §6), так что
  // единственно честный вариант — метка той валюты, чей баланс показан.
  const displayCurrency = wallet?.currency ?? activeCurrency
  const balance = wallet?.available ?? '0'

  const submitSearch = (event: React.FormEvent): void => {
    event.preventDefault()
    router.push(searchHref(query))
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[#2A2A4A] bg-[#0F0F1A]/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="container-1 flex h-14 items-center gap-2 min-[400px]:gap-3">
        <Link href="/" aria-label="На главную" className="shrink-0">
          <span aria-hidden className="inline min-[400px]:hidden">
            <Logo size={28} withWordmark={false} />
          </span>
          <span className="hidden min-[400px]:inline">
            <Logo size={30} />
          </span>
        </Link>

        <form onSubmit={submitSearch} className="relative hidden max-w-md flex-1 md:block">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск игр и провайдеров…"
            aria-label="Поиск"
            className="input pl-9"
          />
        </form>

        <div className="ml-auto flex items-center gap-1.5 min-[400px]:gap-2">
          <Link
            href="/search"
            aria-label="Поиск"
            className="rounded-lg p-1.5 min-[400px]:p-2 text-muted hover:bg-white/5 hover:text-white md:hidden"
          >
            <Search size={20} strokeWidth={1.8} aria-hidden />
          </Link>

          {user ? (
            <>
              <button
                type="button"
                onClick={openWalletSwitcher}
                aria-label="Сменить активный кошелёк"
                className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#2A2A4A]/80 bg-white/[0.06] px-3.5 py-1.5 text-sm font-bold transition hover:border-brand/60 hover:bg-white/[0.08]"
              >
                {formatBalance(balance, displayCurrency)}
                <ChevronDown size={14} aria-hidden className="text-muted" />
              </button>
              <button
                type="button"
                onClick={() => openDeposit(displayCurrency)}
                aria-label="Пополнить"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-money text-bg shadow-lg shadow-money/25 transition hover:bg-money-dark active:scale-95"
              >
                <Plus size={20} strokeWidth={2.4} aria-hidden />
              </button>
              <UserMenu email={user.email} />
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-ghost shrink-0 px-2.5 py-1.5 text-[13px] min-[400px]:px-3 min-[400px]:text-sm"
                onClick={() => openLogin(undefined, 'login')}
              >
                Войти
              </button>
              <button
                type="button"
                className="btn shrink-0 px-2.5 py-1.5 text-[13px] min-[400px]:px-3 min-[400px]:text-sm"
                onClick={() => openLogin(undefined, 'register')}
              >
                Регистрация
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
