'use client'

import Link from 'next/link'

import { GameThumb } from '@/components/casino/GameThumb'
import { useAuth } from '@/stores/auth'
import type { GameDto } from '@/types/casino'

/**
 * Герой гостя (ТЗ ч.5.1 §4.2, донор spinera): один оффер, один CTA,
 * social proof, казино-родной фон, лента слота внизу. Тон — §3:
 * «Твой следующий большой спин.», «N слотов на старте…». Гость-фёрст:
 * «Гость видит слоты. Депозит — когда сами решите.» (донор B).
 * Показывается ТОЛЬКО гостю; залогиненному маркетингового героя нет (§4.3).
 */
export function GuestHero({ games }: { games: GameDto[] }): React.JSX.Element | null {
  const { user } = useAuth()
  const strip = games.slice(0, 4)

  if (user ?? strip.length === 0) {
    return null
  }

  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl border border-[#2A2A4A] bg-gradient-to-br from-[#16213E] via-[#1A1A2E] to-[#0F0F1A]">
      {/* казино-родной фон: мягкие световые пятна (барабаны/монеты), без эмодзи */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#6C63FF]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 left-10 h-48 w-48 rounded-full bg-[#00C853]/15 blur-3xl"
      />

      <div className="relative p-5 md:p-7">
        <h1 className="text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">
          Твой следующий большой спин.
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted md:text-base">
          Гость видит слоты. Депозит — когда сами решите.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Link href="/casino" className="btn px-6">
            Играть сейчас
          </Link>
          <span className="text-xs text-muted">
            {strip.length >= 4 ? '12 слотов на старте' : `${strip.length} слотов на старте`}. Одна
            зелёная кнопка, когда будете готовы.
          </span>
        </div>
      </div>

      {/* лента слота внизу героя — реальные каверы (§2 пр.3) */}
      <div className="relative flex gap-2 px-5 pb-5 md:px-7 md:pb-7">
        {strip.map((game) => (
          <div
            key={game.slug}
            className="h-16 w-16 overflow-hidden rounded-xl border border-[#2A2A4A] bg-[#16213E] md:h-20 md:w-20"
          >
            <GameThumb
              src={game.thumbnailUrl}
              alt=""
              sizes="80px"
            />
          </div>
        ))}
      </div>
    </section>
  )
}
