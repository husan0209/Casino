import type { Metadata } from 'next'

/** GAP-53 (ТЗ ч.5 §20): SEO страницы провайдеров. */
export const metadata: Metadata = {
  title: 'Провайдеры игр',
  description: 'Слоты от лицензированных провайдеров: Pragmatic Play, PG Soft и другие.',
  openGraph: {
    title: 'Провайдеры игр — Casino',
    description: 'Слоты от лицензированных провайдеров',
    type: 'website',
  },
}

export default function ProvidersLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children as React.JSX.Element
}
