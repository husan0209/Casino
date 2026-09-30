'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { GameThumb } from '@/components/casino/GameThumb'
import { useAuth } from '@/stores/auth'
import type { GameDto } from '@/types/casino'

/**
 * Герой гостя (ТЗ ч.5.1 §4.2, донор spinera): один оффер, один CTA,
 * social proof (стек аватарок + «N игроков уже сегодня»), казино-родной фон
 * (барабаны, монеты, 7-ки), лента слота внизу. Тон — §3:
 * «Твой следующий большой спин.». Показывается ТОЛЬКО гостю (§4.3).
 *
 * Цвета приведены к скриншотам: насыщенный фиолетовый градиент, акцент
 * заголовка — brand-light, зелёный оставлен только за деньгами (§2.4).
 */
export function GuestHero({ games }: { games: GameDto[] }): React.JSX.Element | null {
  const { user } = useAuth()
  const strip = games.slice(0, 5)

  if (user ?? strip.length === 0) {
    return null
  }

  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl">
      {/* Насыщенный фиолетовый градиент — как на скриншотах spinera */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#2A1B6B] via-[#1A1040] to-[#0F0F1A]" />

      {/* Декоративные световые пятна — casino-родной фон */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-64 w-64 rounded-full bg-[#6C63FF]/30 blur-[80px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-[#00D2FF]/12 blur-[60px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-20 top-1/2 h-40 w-40 rounded-full bg-[#FF3D71]/10 blur-[50px]"
      />

      {/* Декоративные символы — слот-машина мотив */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-4 top-8 text-[120px] font-black leading-none text-white/[0.03]"
      >
        7
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute right-24 top-20 text-[80px] font-black leading-none text-[#FFB300]/[0.06]"
      >
        ★
      </div>

      <div className="relative p-6 pb-5 md:p-8 md:pb-6">
        {/* ТЗ ч.5.1 §3: капс-лейбл с характером */}
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#B6B1FF]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#00D2FF] shadow-[0_0_9px_#00D2FF]" aria-hidden />
          Новые игры каждую неделю
        </p>

        <h1 className="text-[34px] font-black leading-[1.05] tracking-tight md:text-[44px]">
          Твой следующий
          <br />
          <span className="text-[#8B7FFF]">большой спин.</span>
        </h1>

        <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/60 md:text-base">
          Яркие слоты от лучших провайдеров. Играй с удовольствием — без лишнего.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Link
            href="/casino"
            className="btn px-6 py-3 text-sm font-bold shadow-lg shadow-[#6C63FF]/30"
          >
            Играть сейчас
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>

        {/* Social proof — стек аватарок (донор spinera §4.2) */}
        <div className="mt-5 flex items-center gap-2">
          <div className="flex -space-x-2">
            {['#E53E3E', '#3182CE', '#D69E2E', '#805AD5'].map((color, index) => (
              <span
                key={color}
                className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#1A1040] text-[10px] font-bold text-white"
                style={{ backgroundColor: color, zIndex: 4 - index }}
              >
                {['М', 'P', 'A'][index] ?? '+'}
              </span>
            ))}
            <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#1A1040] bg-white/10 text-[10px] font-medium text-white/70">
              +
            </span>
          </div>
          <span className="text-xs text-white/50">12 400 игроков уже сегодня</span>
        </div>
      </div>

      {/* Лента слотов внизу (реальные каверы §2 пр.3) */}
      <div className="relative flex gap-2.5 overflow-x-auto px-6 pb-6 md:px-8 md:pb-8">
        {strip.map((game) => (
          <div
            key={game.slug}
            className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#16213E] shadow-lg shadow-black/20 md:h-24 md:w-24"
          >
            <GameThumb src={game.thumbnailUrl} alt="" seed={game.slug} sizes="96px" />
          </div>
        ))}
      </div>
    </section>
  )
}
