'use client'

import { useQuery } from '@tanstack/react-query'

import { GameSection } from '@/components/casino/GameSection'
import { HomeChips } from '@/components/casino/HomeChips'
import { ProviderStrip } from '@/components/casino/ProviderStrip'
import { MobileSearchBar } from '@/components/layout/MobileSearchBar'
import { useFavorites } from '@/hooks/useFavorites'
import { apiGet } from '@/lib/api'
import { fetchGamesPage, fetchRecentGames } from '@/lib/api/casino.api'
import { useAuth } from '@/stores/auth'
import type { GameDto, GamesListDto } from '@/types/casino'

/**
 * GAP-52/55 (ТЗ ч.5 §6): главная — витрина слотов, не портал.
 * Своему: 1 «Продолжить играть» → 2 чипы → 3 Популярные → 4 промо-слот
 * (ВЫКЛЮЧЕН: акционного движка нет, ТЗ §2.8/§24 — не обещать бонус) →
 * 5 Новые → 6 Избранное (если не пустое) → 7 лента провайдеров.
 * Гостю (§6.2): hero → Популярные → Новые → лента провайдеров; пустые
 * «Продолжить играть»/«Избранное» не показываем.
 */
export default function Home(): React.JSX.Element {
  const { user } = useAuth()
  const { favoriteGames, favoriteSlugs, toggleFavorite } = useFavorites()

  const { data: popular, isLoading } = useQuery({
    queryKey: ['games-home', 'popular'],
    queryFn: () => apiGet<GamesListDto | GameDto[]>('/casino/games?per_page=12&sort=popular'),
    retry: false,
  })
  const { data: fresh } = useQuery({
    queryKey: ['games-home', 'new'],
    queryFn: () => fetchGamesPage(1, { category: '', provider: '', sort: 'new', q: '' }),
    retry: false,
  })
  const { data: recent } = useQuery({
    queryKey: ['games-recent'],
    queryFn: () => fetchRecentGames(),
    enabled: Boolean(user),
    staleTime: 60_000,
  })

  const popularList: GameDto[] = Array.isArray(popular)
    ? popular
    : (popular?.data ?? [])

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

      {user && <HomeChips />}

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted">Загрузка игр…</div>
      ) : (
        <GameSection
          title={user ? 'Популярные' : 'Популярные слоты'}
          games={popularList}
          favoriteSlugs={favoriteSlugs}
          onToggleFavorite={toggleFavorite}
        />
      )}

      <GameSection
        title="Новые"
        games={fresh?.data ?? []}
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

      <ProviderStrip />
    </div>
  )
}
