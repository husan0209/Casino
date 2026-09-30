'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { type AffiliateAuthState, useAffiliateAuth } from '@/stores/affiliate'

const NAV: Array<[string, string]> = [
  ['Обзор', '/affiliate/dashboard'],
  ['Начисления', '/affiliate/commissions'],
  ['Игроки', '/affiliate/players'],
  ['Ссылки', '/affiliate/links'],
  ['Настройки', '/affiliate/settings'],
]

/**
 * Оболочка кабинета партнёра.
 *
 * Гейт на клиенте (`token === null` → редирект), а не только на API: без него
 * партнёр видел бы пустой «кабинет» без объяснения. Настоящая защита данных —
 * AffiliateAuthGuard на бэкенде; этот экран отвечает только за UX.
 */
export default function AffiliateCabinetLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element | null {
  const router = useRouter()
  const pathname = usePathname()
  const token = useAffiliateAuth((s: AffiliateAuthState) => s.token)
  const logout = useAffiliateAuth((s: AffiliateAuthState) => s.logout)

  useEffect(() => {
    if (token === null) {
      router.replace('/affiliate/login')
    }
  }, [token, router])

  if (token === null) {
    return null
  }

  return (
    <div className="container-1 py-6">
      <div className="mb-5">
        <p className="caps-label">ПАРТНЁРСКАЯ ПРОГРАММА</p>
        <h1 className="page-title">Кабинет партнёра</h1>
      </div>

      {/* Мобильный: горизонтальный скролл, десктоп: сетка. Один компонент,
          чтобы набор пунктов не расходился между брейкпоинтами. */}
      <nav className="scrollbar-hide -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-5 md:px-0">
        {NAV.map(([label, href]) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={
                active
                  ? 'shrink-0 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white'
                  : 'shrink-0 rounded-xl border border-[#2A2A4A] px-4 py-2.5 text-sm font-medium text-white transition hover:border-brand/50'
              }
            >
              {label}
            </Link>
          )
        })}
      </nav>

      {children}

      <button
        onClick={() => {
          logout()
          router.replace('/affiliate')
        }}
        className="btn-ghost mt-8 text-sm"
      >
        Выйти из кабинета
      </button>
    </div>
  )
}
