'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { GameCard } from '@/components/casino/GameCard'
import { apiGet } from '@/lib/api'
import { fetchProviders } from '@/lib/api/casino.api'
import type { GameDto, GamesMetaDto, ProviderDto } from '@/types/casino'

/**
 * GAP-53 (ТЗ ч.5 §7): «{провайдер} — те же карточки, заголовок провайдера,
 * без отдельного визуального языка». Infinite scroll — как в каталоге.
 */
interface CatalogPage {
  data: GameDto[]
  meta: GamesMetaDto
}

export default function ProviderPage(): React.JSX.Element {
  const { slug } = useParams() as { slug: string }

  const { data: providers } = useQuery({
    queryKey: ['providers-page'],
    queryFn: () => fetchProviders(),
    staleTime: 5 * 60 * 1000,
  })
  const provider: ProviderDto | undefined = providers?.find((p) => p.slug === slug)

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['provider-games', slug],
    queryFn: ({ pageParam }) =>
      apiGet<CatalogPage>('/casino/games', { page: pageParam, per_page: 24, provider: slug }),
    enabled: slug.length > 0,
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.meta.hasNext ? lastPage.meta.page + 1 : undefined),
  })

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      { rootMargin: '600px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const games = data?.pages.flatMap((page) => page.data) ?? []

  return (
    <div className="container-1 py-8">
      <div className="mb-2 text-sm text-muted">
        <Link href="/providers" className="hover:text-white">
          Провайдеры
        </Link>{' '}
        / {provider?.name ?? slug}
      </div>
      <h1 className="mb-4 text-2xl font-bold">{provider?.name ?? slug}</h1>
      {provider && (
        <p className="mb-5 text-sm text-muted">Игр в каталоге: {provider.game_count}</p>
      )}

      {isLoading || slug.length === 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="card aspect-[4/5] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {games.map((game) => (
              <GameCard key={game.slug} game={game} />
            ))}
          </div>
          <div ref={sentinelRef} className="h-1" />
          {isFetchingNextPage && (
            <div className="mt-6 text-center text-sm text-muted">Загрузка…</div>
          )}
          {!hasNextPage && games.length > 24 && (
            <div className="mt-6 text-center text-sm text-muted">Больше игр нет</div>
          )}
        </>
      )}
    </div>
  )
}
