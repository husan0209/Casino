'use client'

import { useQuery } from '@tanstack/react-query'

import { GameSection } from '@/components/casino/GameSection'
import { HomeChips } from '@/components/casino/HomeChips'
import { ProviderStrip } from '@/components/casino/ProviderStrip'
import { MobileSearchBar } from '@/components/layout/MobileSearchBar'
import { useFavorites } from '@/hooks/useFavorites'
import { fetchRecentGames } from '@/lib/api/casino.api'
import type { CatalogCategory } from '@/lib/ui/catalog-filters'
import { useAuth } from '@/stores/auth'
import type { GameDto, ProviderDto } from '@/types/casino'

/**
 * GAP-52/55 (ТЗ ч.5 §6) + ISR (§20/§22): тело главной.
 *
 * Публичные полки (популярные, новые, чипы категорий, лента провайдеров)
 * приходят сервером как props — страница статическая с revalidate 60с,
 * клиентский рефетч этих списков не нужен (§22 «ISR главной 60 секунд»).
 * Приватные полки («Продолжить играть», «Избранное») — клиентские islands:
 * сервер их не знает, и гостю они не показываются (§6.2).
 *
 * Порядок §6.1: Продолжить играть → чипы → Популярные → промо (ВЫКЛЮЧЕНО:
 * акционного движка нет, §2.8/§24) → Новые → Избранное → лента провайдеров.
 */
export function HomeView({
  popular,
  fresh,
  categories,
  providers,
}: {
  popular: GameDto[]
  fresh: GameDto[]
  categories: CatalogCategory[]
  providers: ProviderDto[]
}): React.JSX.Element {
  const { user } = useAuth()
  const { favoriteGames, favoriteSlugs, toggleFavorite } = useFavorites()

  const { data: recent } = useQuery({
    queryKey: ['games-recent'],
    queryFn: () => fetchRecentGames(),
    enabled: Boolean(user),
    staleTime: 60_000,
  })

  return (
    <div className="container-1 py-4">
      <MobileSearchBar />

      {!user && (
        <section className="mb-5 rounded-2xl border border-[#2A2A4A] bg-gradient-to-br from-[#16213E] to-[#1A1A2E] p-4">
          <h1 className="text-xl font-bold">Слоты онлайн</h1>
          <p className="mt-1 text-sm text-muted">Тап по игре — и в дело</p>
        </section>
      )}

      {user && (
        <GameSection
          title="Продолжить играть"
          games={recent ?? []}
          variant="row"
          favoriteSlugs={favoriteSlugs}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {user && <HomeChips categories={categories} />}

      <GameSection
        title={user ? 'Популярные' : 'Популярные слоты'}
        games={popular}
        favoriteSlugs={favoriteSlugs}
        onToggleFavorite={toggleFavorite}
      />

      <GameSection
        title="Новые"
        games={fresh}
        favoriteSlugs={favoriteSlugs}
        onToggleFavorite={toggleFavorite}
      />

      {user && (
        <GameSection
          title="Избранное"
          games={favoriteGames}
          favoriteSlugs={favoriteSlugs}
          onToggleFavorite={toggleFavorite}
        />
      )}

      <ProviderStrip providers={providers} />
    </div>
  )
}
