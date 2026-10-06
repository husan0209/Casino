import Link from 'next/link'

/**
 * Нейтральная обвязка правовых документов (GAP-49, правило нейтральности —
 * docs/LEGAL_COMPLIANCE.md §2).
 *
 * Чем отличается от AppHeader + SiteFooter и почему это отдельный компонент:
 * на юридической странице нет бренда, тэглайна, логотипа, бейджей платёжных
 * методов и казино-навигации. Условия использования — не рекламная витрина, и
 * до утверждения реквизитов оператора на них не должно появляться ни одного
 * самоназвания: «кто является оператором» игрок должен читать в самом документе,
 * а не выводить из шапки.
 *
 * Здесь нет ни одного текста, который идентифицирует оператора: ссылки на
 * реквизиты, лицензию и ADR-орган отсылают к содержанию документов.
 */
const LEGAL_DOCS: readonly { href: string; label: string }[] = [
  { href: '/legal/terms', label: 'Условия использования' },
  { href: '/legal/privacy', label: 'Политика конфиденциальности' },
  { href: '/legal/cookies', label: 'Политика cookie' },
  { href: '/legal/responsible-gaming', label: 'Ответственная игра' },
]

export function LegalChrome({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line/60 bg-bg">
        <div className="container-1 flex items-center justify-between gap-3 py-3">
          <Link href="/" className="text-sm text-muted transition hover:text-white">
            ← На главную
          </Link>
          <span className="caps-label mb-0">Правовые документы</span>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-auto border-t border-line/50 bg-bg py-8">
        <nav className="container-1 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
          {LEGAL_DOCS.map((doc) => (
            <Link key={doc.href} href={doc.href} className="transition hover:text-white">
              {doc.label}
            </Link>
          ))}
          <Link href="/support" className="transition hover:text-white">
            Поддержка
          </Link>
        </nav>

        <div className="container-1 mt-5 flex items-start gap-3">
          <span className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-xs font-bold text-danger">
            18+
          </span>
          <p className="text-xs leading-relaxed text-muted">
            Азартные игры могут вызывать зависимость. Играйте ответственно и только на те средства,
            потеря которых для вас допустима.
          </p>
        </div>

        <p className="container-1 mt-4 text-xs leading-relaxed text-white/30">
          Наименование оператора, номер и орган лицензии, реквизиты для обращений и данные
          независимого ADR-органа публикуются в тексте соответствующего документа.
        </p>
      </footer>
    </div>
  )
}
