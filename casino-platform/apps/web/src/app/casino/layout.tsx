import type { Metadata } from 'next'

/**
 * GAP-52 (ТЗ ч.5 §20): SEO каталога — статическая metadata (клиентская
 * страница не может её экспортировать, отдаём из серверного layout).
 */
export const metadata: Metadata = {
  title: 'Каталог слотов — играть онлайн',
  description: 'Слоты, live-казино и настольные игры. Поиск, фильтры по провайдерам.',
  openGraph: {
    title: 'Каталог слотов — Casino',
    description: 'Слоты, live-казино и настольные игры',
    type: 'website',
  },
}

export default function CasinoLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children as React.JSX.Element
}
