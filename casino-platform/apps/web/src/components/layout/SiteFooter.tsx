import Link from 'next/link'

/**
 * Футер (ТЗ ч.5 §4.6): короткий — логотип, 18+, условия, конфиденциальность,
 * ответственная игра. Не витрина провайдеров: иконки платёжных методов
 * появятся после GAP-46 (стенд с гео-конфигом).
 * GAP-49: ссылки на /legal/*; лицензия — после получения (заготовка скрыта).
 */
export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="mt-auto border-t border-[#2A2A4A] bg-[#0F0F1A] py-6">
      <div className="container-1 flex flex-col items-center gap-4 text-sm text-muted md:flex-row md:justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold text-white">Casino</span>
          <span className="rounded-md border border-[#2A2A4A] px-1.5 py-0.5 text-xs font-semibold">18+</span>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link href="/legal/terms" className="hover:text-white">
            Условия использования
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
        </nav>
        <p className="text-xs">© {new Date().getFullYear()} Casino</p>
      </div>
    </footer>
  )
}
