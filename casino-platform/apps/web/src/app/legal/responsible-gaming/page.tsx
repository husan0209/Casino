import { LegalPage } from '@/components/layout/LegalPage'
import { RG_VERSION, rgKeyPoints, rgSections } from '@/content/legal/responsible-gaming'

import type { Metadata } from 'next'

export const metadata: Metadata = {
  // absolute — см. комментарий в ../terms/page.tsx: бренд не входит в правовой документ.
  title: { absolute: 'Ответственная игра' },
  openGraph: { title: 'Ответственная игра' },
}

/**
 * Ответственная игра (GAP-49, ТЗ ч.5 §16.3, ч.7 §15.6). Инструменты в тексте —
 * только те, что исполняются кодом; сверка с IMPLEMENTATION_GAPS.md.
 */
export default function ResponsibleGamingPage(): React.JSX.Element {
  return (
    <LegalPage
      title="Ответственная игра"
      updated={`2026-10-03 · версия ${RG_VERSION}`}
      intro="Игра должна оставаться развлечением. Здесь описано, что доступно, чтобы ею остаться: самоисключение, паузы, лимиты и куда обращаться за помощью."
      keyPoints={rgKeyPoints}
      sections={rgSections}
    />
  )
}
