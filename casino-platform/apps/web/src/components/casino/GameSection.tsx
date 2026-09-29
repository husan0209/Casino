'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { GameCard } from '@/components/casino/GameCard'
import type { GameDto } from '@/types/casino'

/**
 * GAP-55 (ТЗ ч.5 §6.1): полка игр на главной — «Продолжить играть»
 * (горизонтальный ряд), «Популярные», «Новые», «Избранное».
 * Пустые полки не рендерим (§6.2: гостю не показываем пустые разделы).
 * ТЗ ч.5.1 §3: капс-лейбл с характером над заголовком секции
 * (эталон: «ТВОЯ ИСТОРИЯ → Продолжить играть») + тихая ссылка-действие
 * («Вся история →») справа.
 */
export function GameSection({
  title,
  capsLabel,
  actionHref,
  actionLabel,
  games,
  variant = 'grid',
  favoriteSlugs,
  onToggleFavorite,
}: {
  title: string
  capsLabel?: string
  actionHref?: string
  actionLabel?: string
  games: GameDto[]
  variant?: 'grid' | 'row'
  favoriteSlugs?: Set<string>
  onToggleFavorite?: (game: GameDto) => void
}): React.JSX.Element | null {
  if (games.length === 0) {
    return null
  }

  const heading = (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        {capsLabel && <p className="caps-label">{capsLabel}</p>}
        <h2 className="section-title">{title}</h2>
      </div>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-muted transition-colors hover:text-white"
        >
          {actionLabel}
          <ChevronRight size={16} aria-hidden />
        </Link>
      )}
    </div>
  )

  if (variant === 'row') {
    return (
      <section className="mb-6">
        {heading}
        <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-2">
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
      {heading}
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
