'use client'

import { useState } from 'react'

import { gameBadge, gameDisplayName, gameRtpLabel } from '@/lib/ui/game'
import { useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import type { GameDto } from '@/types/casino'

interface GameCardProps {
  game: GameDto
  /** GAP-52: статус избранного от родителя (страница знает список). */
  isFavorite?: boolean | undefined
  onToggleFavorite?: ((game: GameDto) => void) | undefined
}

/**
 * GAP-52 (ТЗ ч.5 §6.4): карточка витрины.
 * - тап по обложке = запуск (кнопок «Играть/Демо» на карточке нет — ТЗ §24);
 * - один бейдж: NEW или HOT (не оба);
 * - тап по «i» = превью: провайдер, RTP, избирание (сердечко в превью);
 * - гость → LoginSheet с продолжением launch после входа (контракт §5.5).
 */
export function GameCard({ game, isFavorite, onToggleFavorite }: GameCardProps): React.JSX.Element {
  const { user } = useAuth()
  const { openLogin } = useUIStore()
  const [preview, setPreview] = useState(false)

  const displayName = gameDisplayName(game)
  const badge = gameBadge(game)
  const rtp = gameRtpLabel(game.rtp)
  const play = (): void => {
    if (!user) {
      openLogin(game.slug)
      return
    }
    window.location.href = `/casino/${game.slug}?launch=1`
  }

  const toggleFavorite = (): void => {
    if (!user) {
      openLogin(game.slug)
      return
    }
    onToggleFavorite?.(game)
  }

  return (
    <div className="card group relative overflow-hidden p-0">
      <button
        type="button"
        onClick={play}
        aria-label={`Играть в ${displayName}`}
        className="block w-full text-left"
      >
        <div className="relative flex aspect-[4/5] items-center justify-center bg-gradient-to-br from-[#22223a] to-[#111122] text-3xl">
          🎰
          {badge && (
            <span
              className={`absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                badge === 'NEW' ? 'bg-[#00D2FF]/20 text-[#00D2FF]' : 'bg-[#FF3D71]/20 text-[#FF3D71]'
              }`}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="p-2">
          <div className="truncate text-sm font-medium">{displayName}</div>
          <div className="truncate text-xs text-muted">{game.provider?.name || 'Demo'}</div>
        </div>
      </button>
      <button
        type="button"
        aria-label="Об игре"
        onClick={() => setPreview((v) => !v)}
        className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-xs text-muted hover:text-white"
      >
        i
      </button>
      {preview && (
        <div className="absolute inset-x-0 bottom-0 space-y-2 border-t border-[#2A2A4A] bg-[#0F0F1A]/95 p-3 text-xs">
          <div className="text-muted">
            Провайдер: <span className="text-white">{game.provider?.name || 'Demo'}</span>
          </div>
          {rtp && (
            <div className="text-muted">
              RTP: <span className="text-white">{rtp}</span>
            </div>
          )}
          <button type="button" onClick={toggleFavorite} className="btn-ghost w-full px-2 py-1.5 text-xs">
            {isFavorite ? '♥ В избранном' : '♡ В избранное'}
          </button>
        </div>
      )}
    </div>
  )
}
