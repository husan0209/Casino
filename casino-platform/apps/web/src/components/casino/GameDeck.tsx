'use client'

import { ChevronLeft, ChevronRight, Dices, Heart, Play, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { GameThumb } from '@/components/casino/GameThumb'
import { gameBadge, gameDisplayName } from '@/lib/ui/game'
import { useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import type { GameDto } from '@/types/casino'

interface GameDeckProps {
  games: GameDto[]
  recentGames?: GameDto[]
  favoriteSlugs?: Set<string>
  onToggleFavorite?: (game: GameDto) => void
}

interface DeckCard {
  game: GameDto
  tag: string
  tagColor: string
}

const EMPTY_GAMES: GameDto[] = []
const EMPTY_FAVORITE_SLUGS = new Set<string>()

export function GameDeck({
  games,
  recentGames = EMPTY_GAMES,
  favoriteSlugs = EMPTY_FAVORITE_SLUGS,
  onToggleFavorite,
}: GameDeckProps): React.JSX.Element | null {
  const { user } = useAuth()
  const { openLogin } = useUIStore()
  const router = useRouter()

  // Формируем колоду 8-12 карт по ТЗ §4.4
  const buildDeck = useCallback((): DeckCard[] => {
    const list: DeckCard[] = []
    const seen = new Set<string>()

    // Свой: последнее/избранное первым
    if (user && recentGames.length > 0) {
      for (const g of recentGames.slice(0, 2)) {
        if (!seen.has(g.slug)) {
          seen.add(g.slug)
          list.push({ game: g, tag: 'Продолжи', tagColor: 'bg-[#6C63FF]/30 text-white' })
        }
      }
    }

    // Избранные
    for (const g of games) {
      if (favoriteSlugs.has(g.slug) && !seen.has(g.slug)) {
        seen.add(g.slug)
        list.push({ game: g, tag: 'Твоё избранное', tagColor: 'bg-[#FF3D71]/30 text-[#FF3D71]' })
        if (list.length >= 4) {
          break
        }
      }
    }

    // Хайп / HOT
    for (const g of games) {
      if (g.isPopular && !seen.has(g.slug)) {
        seen.add(g.slug)
        list.push({ game: g, tag: 'Хайп', tagColor: 'bg-[#FFB300]/30 text-[#FFB300]' })
      }
    }

    // Новинки
    for (const g of games) {
      if (g.isNew && !seen.has(g.slug)) {
        seen.add(g.slug)
        list.push({ game: g, tag: 'Новинка', tagColor: 'bg-[#00D2FF]/30 text-[#00D2FF]' })
      }
    }

    // Остальные
    for (const g of games) {
      if (!seen.has(g.slug)) {
        seen.add(g.slug)
        list.push({ game: g, tag: 'Популярное', tagColor: 'bg-white/10 text-white/80' })
      }
    }

    return list.slice(0, 10)
  }, [games, recentGames, favoriteSlugs, user])

  const [deck, setDeck] = useState<DeckCard[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    setDeck(buildDeck())
  }, [buildDeck])

  if (deck.length === 0) {
    return null
  }

  const nextCard = (): void => {
    setCurrentIndex((prev) => (prev + 1) % deck.length)
  }

  const prevCard = (): void => {
    setCurrentIndex((prev) => (prev - 1 + deck.length) % deck.length)
  }

  const shuffleDeck = (): void => {
    setDeck((prev) => [...prev].sort(() => Math.random() - 0.5))
    setCurrentIndex(0)
  }

  const current = deck[currentIndex]
  if (!current) {
    return null
  }

  const displayName = gameDisplayName(current.game)
  const isFav = favoriteSlugs.has(current.game.slug)
  const badge = gameBadge(current.game)

  const playCurrent = (): void => {
    if (!user) {
      openLogin(current.game.slug)
      return
    }
    router.push(`/casino/${current.game.slug}?launch=1`)
  }

  return (
    <section className="mb-8">
      {/* Заголовок колоды */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="caps-label flex items-center gap-1">
            <Sparkles size={12} className="text-[#00E676]" />
            ВЫБОР МОМЕНТА
          </p>
          <h2 className="section-title">Колода слотов</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Счётчик и кнопка shuffle */}
          <span className="text-xs font-semibold text-muted">
            {currentIndex + 1} / {deck.length}
          </span>
          <button
            type="button"
            onClick={shuffleDeck}
            aria-label="Перемешать колоду"
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#2A2A4A] text-muted transition hover:border-brand hover:text-white"
          >
            <Dices size={16} />
          </button>
        </div>
      </div>

      {/* Контейнер колоды */}
      <div className="relative mx-auto max-w-md">
        {/* Карточка стека */}
        <div className="relative aspect-[16/10] sm:aspect-[16/9] w-full overflow-hidden rounded-3xl border border-[#2A2A4A] bg-[#16213E] shadow-2xl transition-all duration-300">
          <GameThumb src={current.game.thumbnailUrl} alt={displayName} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/20" />

          {/* Верхняя плашка: причина рекомендации + избранное */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur-md ${current.tagColor}`}
            >
              {current.tag}
            </span>

            <button
              type="button"
              onClick={() => onToggleFavorite?.(current.game)}
              className="grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:scale-110"
              aria-label="В избранное"
            >
              <Heart
                size={16}
                className={isFav ? 'fill-[#FF3D71] text-[#FF3D71]' : 'text-white/80'}
              />
            </button>
          </div>

          {/* BIG WIN контекстный бейдж (ТЗ ч.5.1 §4.4) */}
          <div className="absolute right-4 bottom-20 sm:bottom-24 rounded-xl bg-black/70 px-3 py-1.5 text-xs backdrop-blur-md border border-[#00E676]/30">
            <div className="text-[10px] text-muted">Крупный выигрыш</div>
            <div className="font-extrabold text-[#00E676]">+32 400 ₽</div>
          </div>

          {/* Нижняя часть фронт-карты: название + кнопка Играть */}
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/70">{current.game.provider?.name}</span>
                {badge && (
                  <span className="rounded bg-[#00D2FF]/20 px-1.5 py-0.2 text-[9px] font-bold text-[#00D2FF]">
                    {badge}
                  </span>
                )}
              </div>
              <h3 className="truncate text-xl sm:text-2xl font-black text-white">{displayName}</h3>
            </div>

            {/* Единственная кнопка «Играть» на фронт-карте (§4.4) */}
            <button
              type="button"
              onClick={playCurrent}
              className="btn-money shrink-0 px-6 py-3 font-bold shadow-xl"
            >
              <Play size={16} className="fill-current" />
              <span>Играть</span>
            </button>
          </div>
        </div>

        {/* Навигационные стрелки переключения карточек */}
        <div className="mt-3 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={prevCard}
            className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-white transition"
          >
            <ChevronLeft size={16} />
            <span>Назад</span>
          </button>
          <div className="flex gap-1">
            {deck.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentIndex(i)}
                aria-label={`Карта ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentIndex ? 'w-5 bg-[#6C63FF]' : 'w-1.5 bg-white/20 hover:bg-white/40'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={nextCard}
            className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-white transition"
          >
            <span>Дальше</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  )
}
