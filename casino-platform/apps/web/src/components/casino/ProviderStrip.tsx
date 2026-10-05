'use client'

import Link from 'next/link'

import { pickProviderColor } from '@/lib/ui/provider-colors'
import type { ProviderDto } from '@/types/casino'

/**
 * GAP-53/GAP-55 (ТЗ ч.5 §6.1 п.7): тонкая лента логотипов провайдеров.
 * Данные приходят сервером (ISR §22). Don't-лист §6: цветные карточки,
 * не серые буквенные плитки «P, P, H, N». Каждый провайдер получает
 * стабильный цвет по первой букве (общая палитра lib/ui/provider-colors).
 */

export function ProviderStrip({
  providers,
}: {
  providers: ProviderDto[]
}): React.JSX.Element | null {
  if (providers.length === 0) {
    return null
  }

  return (
    <section className="mb-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="caps-label">ПРОВЕРЕННЫЕ СТУДИИ</p>
          <h2 className="section-title">Провайдеры</h2>
        </div>
        <Link
          href="/providers"
          className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-muted transition-colors hover:text-white"
        >
          Все провайдеры →
        </Link>
      </div>
      <div className="scrollbar-hide flex gap-2.5 overflow-x-auto pb-2">
        {providers.map((provider) => {
          const color = pickProviderColor(provider.name)
          return (
            <Link
              key={provider.slug}
              href={`/providers/${provider.slug}`}
              className={`flex shrink-0 items-center gap-3 rounded-xl border border-[#2A2A4A]/60 ${color.bg} px-4 py-3 text-sm font-medium transition hover:border-[#6C63FF]/40 hover:brightness-110`}
            >
              {provider.logo_url ? (
                <img
                  src={provider.logo_url}
                  alt={provider.name}
                  loading="lazy"
                  className="h-8 w-8 rounded-lg object-contain"
                />
              ) : (
                <span
                  className={`grid h-8 w-8 place-items-center rounded-lg ${color.icon} text-sm font-bold text-white`}
                >
                  {provider.name.slice(0, 1)}
                </span>
              )}
              <span className="whitespace-nowrap">{provider.name}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
