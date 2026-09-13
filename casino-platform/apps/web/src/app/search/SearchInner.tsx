'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { GameCard } from '@/components/casino/GameCard'
import { apiGet } from '@/lib/api'
import type { GamesListDto } from '@/types/casino'

/**
 * GAP-52 (ТЗ ч.5 §4.4): внутренний компонент поиска (см. page.tsx — Suspense).
 * localStorage читаем ТОЛЬКО в useEffect: prerender /search без window.
 */
const RECENT_KEY = 'casino-web-recent-searches'

export function SearchInner(): React.JSX.Element {
  const router = useRouter()
  const initial = useSearchParams().get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [submitted, setSubmitted] = useState(initial)
  const [recentSearches, setRecentSearches] = useState<string[]>([])

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

  const submit = (value: string): void => {
    setSubmitted(value)
    try {
      const next = [value, ...recentSearches.filter((r) => r !== value)].slice(0, 3)
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      setRecentSearches(next)
    } catch {
      /* приватный режим — не критично */
    }
    router.replace(`/search?q=${encodeURIComponent(value)}`)
  }

  const list = results?.data ?? []
  const popularList = popular?.data ?? []
  const showEmpty = submitted.length > 0 && !isLoading && list.length === 0

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
          placeholder="Название игры…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск игр"
        />
        <button type="submit" className="btn px-5">
          Найти
        </button>
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
                onClick={() => {
                  setQuery(r)
                  submit(r)
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {submitted.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">
          Введите название игры, чтобы начать поиск
        </div>
      ) : isLoading ? (
        <div className="py-10 text-center text-sm text-muted">Поиск…</div>
      ) : showEmpty ? (
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
