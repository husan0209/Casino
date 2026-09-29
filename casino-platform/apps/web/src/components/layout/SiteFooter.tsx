import Link from 'next/link'

import { Logo } from '@/components/layout/Logo'

/**
 * Футер (ТЗ ч.5.1 §2 пр.10): лого + тэглайн, 18+, Условия, Конфиденциальность,
 * Ответственная игра, Поддержка, иконки платёжных методов гео; одна колонка
 * на телефоне. GAP-49: ссылки на /legal/*; лицензия — после получения.
 * Платёжные методы — статичный набор RUB/CIS-гео; привязка к гео-конфигу
 * появится с GAP-46 (стенд), пока витрина не обещает способы, которых нет.
 */
const PAYMENT_METHODS = ['Visa', 'Mastercard', 'МИР', 'СБП', 'USDT', 'BTC'] as const

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="mt-auto border-t border-[#2A2A4A] bg-[#0F0F1A] py-8">
      <div className="container-1 flex flex-col gap-5 text-sm text-muted md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Logo size={28} />
          <p>Спины, которые хочется повторить.</p>
        </div>

        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/legal/terms" className="hover:text-white">
            Условия
          </Link>
          <Link href="/legal/privacy" className="hover:text-white">
            Конфиденциальность
          </Link>
          <Link href="/legal/cookies" className="hover:text-white">
            Cookie
          </Link>
          <Link href="/legal/responsible-gaming" className="hover:text-white">
            Ответственная игра
          </Link>
          <Link href="/support" className="hover:text-white">
            Поддержка
          </Link>
        </nav>

        <div className="flex flex-wrap items-center gap-1.5">
          {PAYMENT_METHODS.map((method) => (
            <span
              key={method}
              className="rounded-md border border-[#2A2A4A] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            >
              {method}
            </span>
          ))}
          <span className="rounded-md border border-[#2A2A4A] px-1.5 py-0.5 text-xs font-bold">
            18+
          </span>
        </div>
      </div>
      <div className="container-1 mt-5 text-xs">© {new Date().getFullYear()} Casino</div>
    </footer>
  )
}
