'use client'

import Link from 'next/link'

import type { ProviderDto } from '@/types/casino'

/**
 * GAP-53/GAP-55 (ТЗ ч.5 §6.1 п.7): тонкая лента логотипов провайдеров —
 * последний блок главной; тап ведёт на /providers/[slug]. Данные приходят
 * сервером вместе с ISR-рендером главной (§22), клиентского запроса нет.
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
      <h2 className="mb-2 text-sm text-muted">Провайдеры</h2>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {providers.map((provider) => (
          <Link
            key={provider.slug}
            href={`/providers/${provider.slug}`}
            className="card flex shrink-0 items-center gap-2 px-3 py-2 text-xs hover:border-[#6C63FF]/40"
          >
            {provider.logo_url ? (
              <img
                src={provider.logo_url}
                alt={provider.name}
                loading="lazy"
                className="h-6 w-6 rounded object-contain"
              />
            ) : (
              <span className="grid h-6 w-6 place-items-center rounded bg-[#22223a] font-bold">
                {provider.name.slice(0, 1)}
              </span>
            )}
            <span className="whitespace-nowrap">{provider.name}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
