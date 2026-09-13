'use client'

import { Suspense } from 'react'

import { SearchInner } from './SearchInner'

/**
 * GAP-52 (ТЗ ч.5 §4.4): экран глобального поиска. useSearchParams требует
 * Suspense-обёртки при статической генерации (Next 14 prerender),
 * иначе build падает на /search (поймано CI).
 */
export default function SearchPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div className="container-1 py-10 text-center text-sm text-muted">Поиск…</div>}>
      <SearchInner />
    </Suspense>
  )
}
