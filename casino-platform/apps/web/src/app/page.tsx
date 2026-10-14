import { HomeView } from '@/components/casino/HomeView'
import {
  fetchCategoriesServer,
  fetchGamesServer,
  fetchProvidersServer,
  HOME_REVALIDATE_SECONDS,
} from '@/lib/api/server'

import type { Metadata } from 'next'

/**
 * GAP-55 (е) (ТЗ §20/§22): главная — серверный рендер с ISR (revalidate 60с),
 * публичные полки приходят с бэка на сервере, приватные (recent/favorites) —
 * клиентскими островами внутри HomeView.
 *
 * `import type { Metadata } from 'next'` — в конце: в корневом .eslintrc.js
 * группы заданы как [..., ['parent','sibling','index'], 'type'], т.е. type-only
 * импорт НЕ из `@/`-пути попадает в последнюю группу 'type' (найдено CI #86).
 */
export const revalidate = HOME_REVALIDATE_SECONDS

export const metadata: Metadata = {
  title: 'Слоты онлайн — играть на реальные деньги',
  description:
    'Mobile-first казино для СНГ: слоты от лицензированных провайдеров, пополнение картой, СБП и крипто.',
  openGraph: {
    title: 'Слоты онлайн — Casino',
    description: 'Витрина слотов, мультивалютный кошелёк, вывод на карту и в крипту.',
    type: 'website',
  },
}

export default async function Home(): Promise<React.JSX.Element> {
  const [popular, fresh, categories, providers] = await Promise.all([
    fetchGamesServer({ per_page: 12, sort: 'popular' }),
    fetchGamesServer({ per_page: 12, sort: 'new' }),
    fetchCategoriesServer(),
    fetchProvidersServer(),
  ])

  return (
    <HomeView popular={popular} fresh={fresh} categories={categories} providers={providers} />
  )
}
