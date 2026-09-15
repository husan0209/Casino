'use client'

import { Suspense } from 'react'

import { BetHistoryInner } from './BetHistoryInner'

/**
 * GAP-55 (д): фильтры истории ставок в URL (useSearchParams) → нужна
 * Suspense-граница для prerender (урок CI из #80/#84).
 */
export default function HistoryPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div className="container-1 py-8 text-sm text-muted">Загрузка истории…</div>}>
      <BetHistoryInner />
    </Suspense>
  )
}
