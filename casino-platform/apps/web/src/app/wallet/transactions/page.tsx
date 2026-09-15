'use client'

import { Suspense } from 'react'

import { TransactionsInner } from './TransactionsInner'

/**
 * GAP-55 (г): фильтры истории транзакций живут в URL (useSearchParams), поэтому
 * маршруту нужна Suspense-граница — иначе `next build` падает на prerender
 * (тот же класс ошибки, что поймал CI на /search в #80).
 */
export default function TransactionsPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={<div className="container-1 py-8 text-sm text-muted">Загрузка истории…</div>}
    >
      <TransactionsInner />
    </Suspense>
  )
}
