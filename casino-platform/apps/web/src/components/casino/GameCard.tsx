'use client'

import { Heart, Play } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { GameThumb } from '@/components/casino/GameThumb'
import { gameBadge, gameDisplayName, gameHasDemo, gameRtpLabel } from '@/lib/ui/game'
import { useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import type { GameDto } from '@/types/casino'

interface GameCardProps {
  game: GameDto
  isFavorite?: boolean | undefined
  onToggleFavorite?: ((game: GameDto) => void) | undefined
}

/**
 * GAP-52 + ТЗ ч.5 §6.4 + ч.5.1 §4.5: карточка витрины.
 * - Телефон: тап по обложке = запуск; кнопка «i» = превью с RTP и избранным;
 * - Десктоп: при hover плавный оверлей с кнопкой «Играть» и «Демо»;
 * - Один бейдж: NEW или HOT;
 * - Имя и провайдер под обложкой, один раз.
 */
export function GameCard({ game, isFavorite, onToggleFavorite }: GameCardProps): React.JSX.Element {
  const { user } = useAuth()
  const { openLogin } = useUIStore()
  const router = useRouter()
  const [preview, setPreview] = useState(false)

  const displayName = gameDisplayName(game)
  const badge = gameBadge(game)
  const rtp = gameRtpLabel(game.rtp)
  const hasDemo = gameHasDemo(game.hasDemo)

  const play = (): void => {
    if (!user) {
      openLogin(game.slug)
      return
    }
    router.push(`/casino/${game.slug}?launch=1`)
  }

  const prefetch = (): void => {
    router.prefetch(`/casino/${game.slug}`)
  }

  const toggleFavorite = (e?: React.MouseEvent): void => {
    if (e) {
      e.stopPropagation()
    }
    if (!user) {
      openLogin(game.slug)
      return
    }
    onToggleFavorite?.(game)
  }

  return (
    <div className="card virtual-cell group relative overflow-hidden p-0 transition-transform duration-200 hover:-translate-y-1 hover:border-[#6C63FF]/40">
      <div
        onClick={play}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            play()
          }
        }}
        aria-label={`Играть в ${displayName}`}
        className="block w-full cursor-pointer text-left"
      >
        <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-t-2xl bg-gradient-to-br from-[#22223a] to-[#111122] text-3xl">
          <GameThumb src={game.thumbnailUrl} alt={displayName} />

          {badge && (
            <span
              className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-md ${
                badge === 'NEW'
                  ? 'bg-[#00D2FF]/25 text-[#00D2FF] ring-1 ring-[#00D2FF]/40'
                  : 'bg-[#FF3D71]/25 text-[#FF3D71] ring-1 ring-[#FF3D71]/40'
              }`}
            >
              {badge}
            </span>
          )}

          {/* Десктоп-оверлей при hover (§6.4) */}
          <div className="absolute inset-0 hidden flex-col items-center justify-center gap-2 bg-black/60 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100 md:flex">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                play()
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#6C63FF] text-white shadow-lg shadow-[#6C63FF]/50 transition hover:scale-110 active:scale-95"
            >
              <Play size={20} className="ml-0.5 fill-white" aria-hidden />
            </button>
            {hasDemo && (
              <Link
                href={`/casino/${game.slug}`}
                onClick={(e) => e.stopPropagation()}
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur-sm transition hover:bg-white/20"
              >
                Демо
              </Link>
            )}
          </div>
        </div>

        <div className="p-2.5">
          <div className="truncate text-sm font-semibold tracking-tight text-white group-hover:text-brand-light">
            {displayName}
          </div>
          <div className="truncate text-xs text-muted">{game.provider?.name || 'Demo'}</div>
        </div>
      </div>

      {/* Кнопка "i" для превью */}
      <button
        type="button"
        aria-label="Об игре"
        onClick={() => setPreview((v) => !v)}
        className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs font-semibold text-white/80 backdrop-blur-sm transition hover:bg-black/90 hover:text-white"
      >
        i
      </button>

      {/* Мобильная / инлайн плашка превью */}
      {preview && (
        <div className="absolute inset-x-0 bottom-0 z-20 space-y-2 border-t border-[#2A2A4A] bg-[#0F0F1A]/95 p-3 text-xs shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-muted">Провайдер:</span>
            <span className="font-medium text-white">{game.provider?.name || 'Demo'}</span>
          </div>
          {rtp && (
            <div className="flex items-center justify-between">
              <span className="text-muted">RTP:</span>
              <span className="font-medium text-[#00E676]">{rtp}</span>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={(e) => toggleFavorite(e)}
              className="btn-ghost flex-1 py-1.5 text-xs font-medium"
            >
              <Heart
                size={14}
                className={isFavorite ? 'fill-[#FF3D71] text-[#FF3D71]' : 'text-muted'}
              />
              <span>{isFavorite ? 'В избранном' : 'В избранное'}</span>
            </button>
            <Link
              href={`/casino/${game.slug}`}
              className="btn-ghost px-2.5 py-1.5 text-xs font-medium text-muted hover:text-white"
            >
              Инфо →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
