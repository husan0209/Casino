import Link from 'next/link'

import type { ReactNode } from 'react'

/**
 * Публичная страница юридического документа (GAP-49, ТЗ ч.5 §4.6/§16.3, ч.7 §15.6).
 * Структура: заголовок, дата актуальности, разделы с подзаголовками.
 * Тексты — правовой графикой: до публикации реальных текстов от юриста
 * владельца стоит заглушка-дисклеймер (см. docs/IMPLEMENTATION_GAPS.md GAP-49 —
 * приём реальных денег до закрытия юридики недопустим).
 */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string
  updated: string
  intro: string
  sections: { heading: string; body: ReactNode }[]
}): React.JSX.Element {
  return (
    <div className="container-1 py-8 max-w-2xl mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-1">{title}</h1>
        <p className="text-xs text-muted mb-4">Актуально на: {updated}</p>
        <p className="text-sm text-muted mb-6">{intro}</p>
        <div className="space-y-6">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-base font-semibold mb-2">{s.heading}</h2>
              <div className="text-sm text-muted leading-relaxed space-y-2">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted mt-4 text-center">
        <Link href="/" className="text-white">
          ← На главную
        </Link>
      </p>
    </div>
  )
}
