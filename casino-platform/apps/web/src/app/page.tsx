'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { GameCard } from '@/components/casino/GameCard'
import { toast } from '@/components/ui/toaster'
import { apiGet } from '@/lib/api'
import { addFavorite, removeFavorite } from '@/lib/api/casino.api'
import { useAuth } from '@/stores/auth'
import type { GameDto, GamesListDto, RecentGameDto } from '@/types/casino'

/**
 * GAP-52 (ТЗ ч.5 §6): витрина slot-first.
 * Своему игроку первым блоком — «Продолжить играть» (last played, до 12);
 * гостю пустой блок не показываем (ТЗ §6.2). Избранное — optimistic update.
 */
export default function Home(): React.JSX.Element {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [favoriteSlugs, setFavoriteSlugs] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['games-home'],
    queryFn: () => apiGet<GamesListDto | GameDto[]>('/casino/games?per_page=12&sort=popular'),
    retry: false,
  })

  const { data: recent } = useQuery({
    queryKey: ['games-recent'],
    queryFn: () => apiGet<RecentGameDto[]>('/casino/recent'),
    enabled: Boolean(user),
    staleTime: 60_000,
  })

  // избранные подтягиваем один раз для статуса сердечек в превью
  const { data: favoritesData } = useQuery({
    queryKey: ['favorites-ids'],
    queryFn: () => apiGet<{ data: GameDto[] }>('/casino/favorites?per_page=100'),
    enabled: Boolean(user),
    staleTime: 60_000,
  })

  const favoriteMutation = useMutation({
    mutationFn: ({ game, next }: { game: GameDto; next: boolean }) =>
      next ? addFavorite(game.slug) : removeFavorite(game.slug),
    onMutate: async ({ game, next }) => {
      setFavoriteSlugs((prev) => {
        const copy = new Set(prev)
        if (next) {
          copy.add(game.slug)
        } else {
          copy.delete(game.slug)
        }
        return copy
      })
      return { previous: favoriteSlugs }
    },
    onError: () => {
      setFavoriteSlugs(new Set(favoritesData?.data.map((g) => g.slug) ?? []))
      toast.error('Не удалось обновить избранное')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['favorites-ids'] })
    },
  })

  const games: GameDto[] = Array.isArray(data) ? data : (data?.data ?? [])
  const fallback: GameDto[] = [
    { id: 'demo-sweet-fruits', slug: 'demo-sweet-fruits', name: 'Sweet Fruits', provider: { id: 'demo', slug: 'demo', name: 'Demo' } },
    { id: 'demo-lucky-sevens', slug: 'demo-lucky-sevens', name: 'Lucky Sevens', provider: { id: 'demo', slug: 'demo', name: 'Demo' } },
    { id: 'demo-book-of-demo', slug: 'demo-book-of-demo', name: 'Book of Demo', provider: { id: 'demo', slug: 'demo', name: 'Demo' } },
  ]

  const list = games.length ? games : fallback
  const recentList = recent?.slice(0, 12) ?? []
  const effectiveFavorites = favoriteSlugs.size
    ? favoriteSlugs
    : new Set(favoritesData?.data.map((g) => g.slug) ?? [])

  const toggleFavorite = (game: GameDto): void => {
    favoriteMutation.mutate({ game, next: !effectiveFavorites.has(game.slug) })
  }

  return (
    <div className="container-1 py-4">
      {!user && (
        <section className="mb-4 rounded-2xl border border-[#2A2A4A] bg-gradient-to-br from-[#16213E] to-[#1A1A2E] p-4">
          <h1 className="text-xl font-bold">Слоты онлайн</h1>
          <p className="mt-1 text-sm text-muted">Тап по игре — и в дело</p>
        </section>
      )}

      {user && recentList.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Продолжить играть</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {recentList.map((g) => (
              <GameCard key={g.slug} game={g} isFavorite={effectiveFavorites.has(g.slug)} onToggleFavorite={toggleFavorite} />
            ))}
          </div>
        </section>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{user ? 'Популярные' : 'Популярные слоты'}</h2>
      </div>

      {isLoading ? (
        <div className="text-muted py-8 text-center text-sm">Загрузка игр…</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {list.slice(0, 12).map((g) => (
            <GameCard key={g.slug} game={g} isFavorite={effectiveFavorites.has(g.slug)} onToggleFavorite={toggleFavorite} />
          ))}
        </div>
      )}
    </div>
  )
}
