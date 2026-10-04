'use client'

import { ArrowRight, Handshake } from 'lucide-react'
import Link from 'next/link'

import { useAuth } from '@/stores/auth'

/**
 * Партнёрский баннер главной (ТЗ ч.8, §6.1 п.0): единственный маркетинговый
 * герой залогиненного — в языке гостевого GuestHero (§4.2), один оффер,
 * один CTA на /affiliate. Без выдуманных цифр: только обещания с лендинга
 * программы — RevShare от NGR, ежедневные начисления, вывод через кассу.
 */
export function PartnerHero(): React.JSX.Element | null {
  const { user } = useAuth()

  if (!user) {
    return null
  }

  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl">
      {/* Тот же фиолетовый градиент, что у гостевого героя — одна дизайн-система */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#2A1B6B] via-[#1A1040] to-[#0F0F1A]" />

      {/* Световые пятна — акцент смещён в money-зелёный */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-64 w-64 rounded-full bg-money/20 blur-[80px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-[#6C63FF]/25 blur-[60px]"
      />

      {/* Декоративный «%» — watermark RevShare */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-6 top-6 text-[120px] font-black leading-none text-white/[0.03]"
      >
        %
      </div>

      <div className="relative p-6 pb-5 md:p-8 md:pb-6">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-money">
          <Handshake size={14} aria-hidden />
          Партнёрская программа
        </p>

        <h2 className="text-[28px] font-black leading-[1.1] tracking-tight md:text-4xl">
          Станьте нашим
          <br />
          <span className="text-money">партнёром.</span>
        </h2>

        <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/60 md:text-base">
          Приводите игроков и получайте процент от их ставок — ежедневно, прозрачно, с полной
          разбивкой расчёта.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Link
            href="/affiliate"
            className="inline-flex items-center gap-2 rounded-xl bg-[#8B7FFF] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#6C63FF]/30 transition hover:bg-[#6C63FF] active:scale-[0.97]"
          >
            Стать партнёром
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>

        {/* Честные обещания вместо social-proof аватарок — с лендинга /affiliate */}
        <div className="mt-5 flex flex-wrap gap-2">
          {['RevShare от NGR', 'Начисления ежедневно', 'Вывод через кассу'].map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-white/70"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
