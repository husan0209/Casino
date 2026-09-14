'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { fetchProviders } from '@/lib/api/casino.api'

/**
 * GAP-53 (ТЗ ч.5 §2.9): страница провайдеров — сетка карточек
 * (название, число игр, заглушка лого при отсутствии logo_url).
 */
export default function ProvidersPage(): React.JSX.Element {
  const { data: providers, isLoading } = useQuery({
    queryKey: ['providers-page'],
    queryFn: () => fetchProviders(),
    staleTime: 5 * 60 * 1000,
  })

  const list = providers ?? []

  return (
    <div className="container-1 py-8">
      <h1 className="mb-4 text-2xl font-bold">Провайдеры</h1>
      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted">Загрузка…</div>
      ) : list.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">
          Провайдеры ещё не подключены
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {list.map((provider) => (
            <Link
              key={provider.slug}
              href={`/providers/${provider.slug}`}
              className="card group flex flex-col items-center gap-3 p-4 text-center transition hover:border-[#6C63FF]/40"
            >
              {provider.logo_url ? (
                <img
                  src={provider.logo_url}
                  alt={provider.name}
                  loading="lazy"
                  className="h-12 w-12 rounded-xl object-contain"
                />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[#22223a] to-[#111122] text-lg font-bold">
                  {provider.name.slice(0, 1)}
                </div>
              )}
              <div>
                <div className="text-sm font-medium">{provider.name}</div>
                <div className="text-xs text-muted">{provider.game_count} игр</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
