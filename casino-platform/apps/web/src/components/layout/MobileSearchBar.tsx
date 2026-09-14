'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { searchHref } from '@/lib/ui/desktop-nav'

/**
 * GAP-54 (ТЗ ч.5 §4.1/§4.4): поле глобального поиска под шапкой на главной —
 * телефон. На десктопе поиск живёт в хедере (§4.5), поэтому скрыто с md.
 * Enter/кнопка ведут на /search?q= — там результаты по играм и провайдерам.
 */
export function MobileSearchBar(): React.JSX.Element {
  const router = useRouter()
  const [query, setQuery] = useState('')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        router.push(searchHref(query))
      }}
      className="mb-4 flex gap-2 md:hidden"
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск игр и провайдеров…"
        aria-label="Поиск"
        className="input flex-1"
      />
      <button type="submit" className="btn px-4" aria-label="Найти">
        🔍
      </button>
    </form>
  )
}
