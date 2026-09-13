'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { GameCard } from '@/components/casino/GameCard'
import { apiGet } from '@/lib/api'
import type { GameDto, GamesMetaDto } from '@/types/casino'

/**
 * GAP-52 (ТЗ ч.5 §7): каталог с infinite scroll (IntersectionObserver),
 * скелетоны загрузки, «повторить» при ошибке, в конце «больше игр нет».
 * Фильтры: категория/провайдер/поиск; счётчик найденного обязателен.
 */
interface CatalogPage {
  data: GameDto[]
  meta: GamesMetaDto
}

export default function CasinoPage(): React.JSX.Element {
  const [category, setCategory] = useState('')
  const [provider, setProvider] = useState('')
  const [search, setSearch] = useState('')

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['games', category, provider, search],
      queryFn: ({ pageParam }) =>
        apiGet<CatalogPage>('/casino/games', {
          page: pageParam,
          per_page: 24,
          category: category || undefined,
          provider: provider || undefined,
          search: search || undefined,
        }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) => (lastPage.meta.hasNext ? lastPage.meta.page + 1 : undefined),
    })

  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiGet<GameDto[] | { data: GameDto[] }>('/casino/providers'),
    staleTime: 5 * 60 * 1000,
  })
  const provList: GameDto[] = Array.isArray(providers) ? providers : (providers?.data ?? [])

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

  const games = data?.pages.flatMap((p) => p.data) ?? []
  const total = data?.pages[0]?.meta?.total ?? games.length

  return (
    <div className="container-1 py-8">
      <h1 className="mb-4 text-2xl font-bold">Каталог игр</h1>
      <div className="card mb-5 flex flex-wrap gap-3 items-center">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="input w-auto"
          aria-label="Категория"
        >
          <option value="">Все категории</option>
          <option value="slots">Слоты</option>
          <option value="live_casino">Live Казино</option>
          <option value="table_games">Настольные</option>
          <option value="instant_games">Быстрые</option>
        </select>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="input w-auto"
          aria-label="Провайдер"
        >
          <option value="">Все провайдеры</option>
          {provList.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Поиск…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-56"
          aria-label="Поиск"
        />
        <div className="text-sm text-muted ml-auto">
          {isLoading ? 'Загрузка…' : `${total} игр`}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card animate-pulse aspect-[4/5]" />
          ))}
        </div>
      ) : isError ? (
        <div className="py-12 text-center">
          <p className="mb-3 text-muted text-sm">Не удалось загрузить игры</p>
          <button type="button" className="btn-ghost" onClick={() => void refetch()}>
            Повторить
          </button>
        </div>
      ) : games.length === 0 ? (
        <div className="py-12 text-center text-muted">
          Ничего не найдено.{' '}
          <Link href="/casino" className="text-[#6C63FF]">
            Сбросить фильтры
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {games.map((g) => (
              <GameCard key={g.slug} game={g} />
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
