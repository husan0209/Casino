'use client'

import { GameCard } from '@/components/casino/GameCard'
import type { GameDto } from '@/types/casino'

/**
 * GAP-55 (ТЗ ч.5 §6.1): полка игр на главной — «Продолжить играть»
 * (горизонтальный ряд), «Популярные», «Новые», «Избранное».
 * Пустые полки не рендерим (§6.2: гостю не показываем пустые разделы).
 */
export function GameSection({
  title,
  games,
  variant = 'grid',
  favoriteSlugs,
  onToggleFavorite,
}: {
  title: string
  games: GameDto[]
  variant?: 'grid' | 'row'
  favoriteSlugs?: Set<string>
  onToggleFavorite?: (game: GameDto) => void
}): React.JSX.Element | null {
  if (games.length === 0) {
    return null
  }

  if (variant === 'row') {
    return (
      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {games.slice(0, 12).map((game) => (
            <div key={game.slug} className="w-36 shrink-0">
              <GameCard
                game={game}
                isFavorite={favoriteSlugs?.has(game.slug) ?? false}
                onToggleFavorite={onToggleFavorite}
              />
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {games.slice(0, 12).map((game) => (
          <GameCard
            key={game.slug}
            game={game}
            isFavorite={favoriteSlugs?.has(game.slug) ?? false}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </section>
  )
}
