'use client'

import { Suspense } from 'react'

import { CasinoInner } from './CasinoInner'

/**
 * GAP-55: каталог читает фильтры из URL (useSearchParams) — на статической
 * странице это требует Suspense-границы, иначе `next build` падает на
 * prerender (той же причиной упал /search в #80).
 */
export default function CasinoPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="container-1 py-8 text-center text-sm text-muted">Загрузка каталога…</div>
      }
    >
      <CasinoInner />
    </Suspense>
  )
}
