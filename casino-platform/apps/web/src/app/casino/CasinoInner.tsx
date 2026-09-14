'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { CatalogFilterBar } from '@/components/casino/CatalogFilterBar'
import { GameCard } from '@/components/casino/GameCard'
import { fetchGamesPage } from '@/lib/api/casino.api'
import { catalogHref, parseFilters, type CatalogFilters } from '@/lib/ui/catalog-filters'

/**
 * GAP-55 (ТЗ ч.5 §7): фильтры каталога живут в URL
 * (?category=&provider=&sort=&q=), их меняет CatalogFilterBar; здесь — только
 * infinite scroll (IntersectionObserver), скелетоны, «повторить», «больше нет».
 * Ссылка вида /casino?category=slots из чипов главной (§6.1) попадает сюда же.
 */
export function CasinoInner(): React.JSX.Element {
  const router = useRouter()
  const search = useSearchParams()

  const filters: CatalogFilters = useMemo(() => parseFilters(search), [search])

  const applyFilters = useCallback(
    (patch: Partial<CatalogFilters>): void => {
      router.replace(catalogHref({ ...filters, ...patch }))
    },
    [filters, router],
  )

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['games', filters.category, filters.provider, filters.sort, filters.q],
      queryFn: ({ pageParam }) => fetchGamesPage(pageParam, filters),
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
  const total = data?.pages[0]?.meta.total ?? games.length

  return (
    <div className="container-1 py-8">
      <h1 className="mb-4 text-2xl font-bold">Каталог игр</h1>
      <CatalogFilterBar filters={filters} total={total} loading={isLoading} onChange={applyFilters} />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="card aspect-[4/5] animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="py-12 text-center">
          <p className="mb-3 text-sm text-muted">Не удалось загрузить игры</p>
          <button type="button" className="btn-ghost" onClick={() => void refetch()}>
            Повторить
          </button>
        </div>
      ) : games.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">
          Ничего не найдено.{' '}
          <button
            type="button"
            className="text-[#6C63FF] underline"
            onClick={() => applyFilters({ category: '', provider: '', sort: '', q: '' })}
          >
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {games.map((game) => (
              <GameCard key={game.slug} game={game} />
            ))}
          </div>
          <div ref={sentinelRef} className="h-1" />
          {isFetchingNextPage && <div className="mt-6 text-center text-sm text-muted">Загрузка…</div>}
          {!hasNextPage && games.length > 24 && (
            <div className="mt-6 text-center text-sm text-muted">Больше игр нет</div>
          )}
        </>
      )}
    </div>
  )
}
