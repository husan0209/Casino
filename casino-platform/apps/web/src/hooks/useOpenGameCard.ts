'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { type GamePreviewOptions, useUIStore } from '@/stores/ui'

/** Tailwind `md` = 768px: ниже — телефон, где карточка игры живёт шторкой. */
const COMPACT_QUERY = '(max-width: 767px)'

/**
 * До монтирования и на сервере — `false`: первый рендер страницы не должен
 * зависеть от ширины экрана зрителя, иначе разметка разойдётся на hydration.
 */
function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY)
    const sync = (): void => setCompact(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return compact
}

/**
 * Открытие карточки игры (ТЗ ч.5.1 §4.5): на телефоне — шторка поверх витрины,
 * на планшете и десктопе — страница `/casino/<slug>`. Шторка держит короткое:
 * обложку, характеристики и две кнопки запуска. Описание, похожие слоты и
 * хлебные крошки остаются на странице — в пол-экрана их не тащим.
 */
export function useOpenGameCard(): (options: GamePreviewOptions) => void {
  const compact = useCompactViewport()
  const { openGamePreview } = useUIStore()
  const router = useRouter()

  return (options: GamePreviewOptions): void => {
    if (compact) {
      openGamePreview(options)
      return
    }
    router.push(`/casino/${options.game.slug}`)
  }
}
