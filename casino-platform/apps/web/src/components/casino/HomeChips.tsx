'use client'

import Link from 'next/link'

import { buildHomeChips, type CatalogCategory } from '@/lib/ui/catalog-filters'

/**
 * GAP-55 (б/е) (ТЗ ч.5 §6.1 п.2): чипы под шапкой главной — категории из API
 * с отсечением пустых по game_count (§7) + «Популярные»/«Новые».
 * Данные приходят сервером (ISR главной, §22), отдельного клиентского запроса нет.
 * Каждая ссылка ведёт в каталог с фильтром в URL (§7) — ссылка копибельна.
 */
export function HomeChips({ categories }: { categories: CatalogCategory[] }): React.JSX.Element | null {
  const chips = buildHomeChips(categories)
  if (chips.length === 0) {
    return null
  }

  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.href}
          href={chip.href}
          className="rounded-full border border-[#2A2A4A] px-3 py-1.5 text-xs text-muted transition hover:border-[#6C63FF]/40 hover:text-white"
        >
          {chip.label}
        </Link>
      ))}
    </div>
  )
}
