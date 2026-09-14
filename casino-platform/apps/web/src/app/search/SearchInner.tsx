'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { GameCard } from '@/components/casino/GameCard'
import { apiGet } from '@/lib/api'
import { fetchProviders, fetchRecentGames } from '@/lib/api/casino.api'
import { searchHref } from '@/lib/ui/desktop-nav'
import { useAuth } from '@/stores/auth'
import type { GamesListDto, ProviderDto } from '@/types/casino'

/**
 * GAP-52/GAP-54 (ТЗ ч.5 §4.4): экран глобального поиска.
 * - ищем игры (API search) И провайдеров (фильтр списка);
 * - показываем недавние запросы (localStorage) и last played (§4.4);
 * - пустой результат — похожие слоты (популярные) + сброс.
 * localStorage — только в useEffect: prerender без window (поймано CI в #80).
 */
const RECENT_KEY = 'casino-web-recent-searches'

export function SearchInner(): React.JSX.Element {
  const router = useRouter()
  const initial = useSearchParams().get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [submitted, setSubmitted] = useState(initial)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const { user } = useAuth()

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_KEY)
      setRecentSearches(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      /* приватный режим — не критично */
    }
  }, [])

  const { data: results, isLoading } = useQuery({
    queryKey: ['search', submitted],
    queryFn: () =>
      apiGet<GamesListDto>('/casino/games', { search: submitted || undefined, per_page: 24 }),
    enabled: submitted.length > 0,
  })

  const { data: popular } = useQuery({
    queryKey: ['search-fallback-popular'],
    queryFn: () => apiGet<GamesListDto>('/casino/games?per_page=6&sort=popular'),
    enabled: submitted.length > 0 && (results?.data.length ?? 0) === 0 && !isLoading,
  })

  // Провайдеры ищем по тому же запросу (§4.4 «ищем игры и провайдеров»)
  const { data: providers } = useQuery({
    queryKey: ['providers-page'],
    queryFn: () => fetchProviders(),
    staleTime: 5 * 60 * 1000,
  })

  // last played — подсказка, пока запрос не введён (§4.4)
  const { data: recent } = useQuery({
    queryKey: ['games-recent'],
    queryFn: () => fetchRecentGames(),
    enabled: Boolean(user) && submitted.length === 0,
    staleTime: 60_000,
  })

  const submit = (value: string): void => {
    setSubmitted(value)
    setQuery(value)
    try {
      const next = [value, ...recentSearches.filter((r) => r !== value)].slice(0, 3)
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      setRecentSearches(next)
    } catch {
      /* приватный режим — не критично */
    }
    router.replace(searchHref(value))
  }

  const list = results?.data ?? []
  const popularList = popular?.data ?? []
  const lastPlayed = recent ?? []
  const needle = submitted.trim().toLowerCase()
  const matchedProviders: ProviderDto[] =
    needle.length === 0
      ? []
      : (providers ?? []).filter((p) => p.name.toLowerCase().includes(needle))
  const showEmpty = submitted.length > 0 && !isLoading && list.length === 0
  const nothingFound = showEmpty && matchedProviders.length === 0

  return (
    <div className="container-1 py-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(query.trim())
        }}
        className="mb-5 flex gap-2"
      >
        <input
          autoFocus
          className="input flex-1"
          placeholder="Название игры или провайдера…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск игр и провайдеров"
        />
        <button type="submit" className="btn px-5">
          Найти
        </button>
        {submitted.length > 0 && (
          <button
            type="button"
            className="btn-ghost px-4"
            onClick={() => {
              setSubmitted('')
              setQuery('')
              router.replace('/search')
            }}
          >
            Сброс
          </button>
        )}
      </form>

      {recentSearches.length > 0 && submitted.length === 0 && (
        <div className="mb-6">
          <div className="mb-2 text-sm text-muted">Недавние запросы</div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((r) => (
              <button
                key={r}
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                onClick={() => submit(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {submitted.length === 0 && lastPlayed.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-sm text-muted">Продолжить играть</div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {lastPlayed.slice(0, 6).map((g) => (
              <GameCard key={g.slug} game={g} />
            ))}
          </div>
        </div>
      )}

      {matchedProviders.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-sm text-muted">Провайдеры</div>
          <div className="flex flex-wrap gap-2">
            {matchedProviders.map((p) => (
              <Link
                key={p.slug}
                href={`/providers/${p.slug}`}
                className="card px-3 py-2 text-sm hover:border-[#6C63FF]/40"
              >
                {p.name} <span className="text-xs text-muted">· {p.game_count} игр</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {submitted.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">
          Введите название игры или провайдера
        </div>
      ) : isLoading ? (
        <div className="py-10 text-center text-sm text-muted">Поиск…</div>
      ) : nothingFound ? (
        <div>
          <p className="mb-4 text-sm text-muted">
            По запросу «{submitted}» ничего не найдено. Попробуйте популярные:
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {popularList.map((g) => (
              <GameCard key={g.slug} game={g} />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {list.map((g) => (
            <GameCard key={g.slug} game={g} />
          ))}
        </div>
      )}
    </div>
  )
}
