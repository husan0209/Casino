import Link from 'next/link'

import { Logo } from '@/components/layout/Logo'

/**
 * Футер (ТЗ ч.5.1 §2 пр.10): лого + тэглайн, 18+, Условия, Конфиденциальность,
 * Ответственная игра, Поддержка, иконки платёжных методов гео; одна колонка
 * на телефоне. Приведён к скриншотам spinera.
 */
const PAYMENT_METHODS = ['Visa', 'Mastercard', 'МИР', 'СБП', 'USDT', 'BTC'] as const

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="mt-auto border-t border-[#2A2A4A]/50 bg-[#0F0F1A] py-8">
      <div className="container-1 flex flex-col gap-6 text-sm text-muted md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Logo size={28} />
          <p className="text-white/40">Спины, которые хочется повторить.</p>
        </div>

        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/legal/terms" className="transition hover:text-white">
            Условия
          </Link>
          <Link href="/legal/privacy" className="transition hover:text-white">
            Конфиденциальность
          </Link>
          <Link href="/legal/responsible-gaming" className="transition hover:text-white">
            Ответственная игра
          </Link>
          <Link href="/support" className="transition hover:text-white">
            Поддержка
          </Link>
          {/* Партнёрская программа для вебмастеров (ТЗ ч.8). Отдельная от
              игровой рефералки: другой контрагент и другие правила. */}
          <Link href="/affiliate" className="transition hover:text-white">
            Партнёрам
          </Link>
        </nav>

        <div className="flex flex-wrap items-center gap-1.5">
          {PAYMENT_METHODS.map((method) => (
            <span
              key={method}
              className="rounded-md border border-[#2A2A4A]/60 bg-white/[0.03] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/50"
            >
              {method}
            </span>
          ))}
          <span className="ml-1 rounded-md border border-[#FF3D71]/30 bg-[#FF3D71]/10 px-2 py-1 text-xs font-bold text-[#FF3D71]">
            18+
          </span>
        </div>
      </div>
      <div className="container-1 mt-6 text-xs text-white/20">
        © {new Date().getFullYear()} spinera · Casino Club
      </div>
    </footer>
  )
}
