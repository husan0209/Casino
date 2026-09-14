'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { GameCard } from '@/components/casino/GameCard'
import { apiGet } from '@/lib/api'
import { useFavorites } from '@/hooks/useFavorites'
import { useAuth } from '@/stores/auth'
import type { GamesListDto } from '@/types/casino'

/**
 * GAP-52/GAP-55 (ТЗ ч.5 §7): страница избранного. Данные и мутации — через
 * useFavorites (общий кеш с главной: снятое сердце исчезает и там, и там).
 * Пустое состояние — 6 популярных + CTA «В каталог» (EmptyState с действием, §3.1).
 */
export default function FavoritesPage(): React.JSX.Element {
  const { user } = useAuth()
  const { favoriteGames, favoriteSlugs, toggleFavorite } = useFavorites()

  const isEmpty = favoriteGames.length === 0
  const { data: popular } = useQuery({
    queryKey: ['games-popular'],
    queryFn: () => apiGet<GamesListDto>('/casino/games?per_page=6&sort=popular'),
    enabled: Boolean(user) && isEmpty,
  })

  if (!user) {
    return <div className="container-1 py-8">Войдите в аккаунт</div>
  }

  return (
    <div className="container-1 py-8">
      <h1 className="mb-4 text-2xl font-bold">Избранное</h1>

      {favoriteGames.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {favoriteGames.map((game) => (
            <GameCard
              key={game.slug}
              game={game}
              isFavorite={favoriteSlugs.has(game.slug)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      ) : (
        <div>
          <p className="mb-4 text-sm text-muted">
            Здесь появятся игры, которые вы отметите сердечком в превью карточки
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {(popular?.data ?? []).map((game) => (
              <GameCard
                key={game.slug}
                game={game}
                isFavorite={favoriteSlugs.has(game.slug)}
                onToggleFavorite={toggleFavorite}
              />
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
