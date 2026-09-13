'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'

import { GameCard } from '@/components/casino/GameCard'
import { toast } from '@/components/ui/toaster'
import { apiGet } from '@/lib/api'
import { addFavorite, fetchFavoriteGames, removeFavorite } from '@/lib/api/casino.api'
import { useAuth } from '@/stores/auth'
import type { GameDto, GamesListDto } from '@/types/casino'

/**
 * GAP-52 (ТЗ ч.5 §7): страница избранного. Защищена для гостя приглашением
 * войти (soft-gate, как остальные страницы web); пустое состояние — 6
 * популярных слотов + CTA «В каталог» (не пустой текст — ТЗ §3.1 EmptyState).
 */
export default function FavoritesPage(): React.JSX.Element {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: favorites, isLoading } = useQuery({
    queryKey: ['favorites-page'],
    queryFn: () => fetchFavoriteGames(1, 24),
    enabled: Boolean(user),
  })

  const { data: popular } = useQuery({
    queryKey: ['games-popular'],
    queryFn: () => apiGet<GamesListDto>('/casino/games?per_page=6&sort=popular'),
    enabled: Boolean(user) && (favorites?.data.length ?? 0) === 0,
  })

  const mutation = useMutation({
    mutationFn: ({ game, next }: { game: GameDto; next: boolean }) =>
      next ? addFavorite(game.slug) : removeFavorite(game.slug),
    onError: () => toast.error('Не удалось обновить избранное'),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['favorites-page'] })
      void queryClient.invalidateQueries({ queryKey: ['favorites-ids'] })
    },
  })

  if (!user) {
    return <div className="container-1 py-8">Войдите в аккаунт</div>
  }

  const list = favorites?.data ?? []
  const popularList = popular?.data ?? []

  return (
    <div className="container-1 py-8">
      <h1 className="mb-4 text-2xl font-bold">Избранное</h1>
      {isLoading ? (
        <div className="text-muted py-8 text-center text-sm">Загрузка…</div>
      ) : list.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {list.map((g) => (
            <GameCard
              key={g.slug}
              game={g}
              isFavorite
              onToggleFavorite={(game) => mutation.mutate({ game, next: false })}
            />
          ))}
        </div>
      ) : (
        <div>
          <p className="mb-4 text-sm text-muted">
            Здесь появятся игры, которые вы отметите сердечком
          </p>
          {popularList.length > 0 && (
            <h2 className="mb-3 text-lg font-semibold">Популярные сейчас</h2>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {popularList.map((g) => (
              <GameCard key={g.slug} game={g} onToggleFavorite={(game) => mutation.mutate({ game, next: true })} />
            ))}
          </div>
          <Link href="/casino" className="btn mt-6 inline-flex">
            В каталог
          </Link>
        </div>
      )}
    </div>
  )
}
