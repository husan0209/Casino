'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { fetchCategories } from '@/lib/api/casino.api'
import { buildHomeChips } from '@/lib/ui/catalog-filters'

/**
 * GAP-55 (ТЗ ч.5 §6.1 п.2): чипы под шапкой на главной — категории из API
 * (пустые отсекаются по game_count, §7) + «Популярные»/«Новые».
 * Каждый чип ведёт в каталог с фильтром в URL, т.е. ссылка копибельна (§7).
 */
export function HomeChips(): React.JSX.Element | null {
  const { data: categories } = useQuery({
    queryKey: ['casino-categories'],
    queryFn: () => fetchCategories(),
    staleTime: 5 * 60 * 1000,
  })

  const chips = buildHomeChips(categories ?? [])
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
