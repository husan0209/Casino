'use client'

import { useQuery } from '@tanstack/react-query'

import { GameDeck } from '@/components/casino/GameDeck'
import { GameSection } from '@/components/casino/GameSection'
import { GuestHero } from '@/components/casino/GuestHero'
import { HomeChips } from '@/components/casino/HomeChips'
import { ProviderStrip } from '@/components/casino/ProviderStrip'
import { MobileSearchBar } from '@/components/layout/MobileSearchBar'
import { useFavorites } from '@/hooks/useFavorites'
import { fetchRecentGames } from '@/lib/api/casino.api'
import type { CatalogCategory } from '@/lib/ui/catalog-filters'
import { useAuth } from '@/stores/auth'
import type { GameDto, ProviderDto } from '@/types/casino'

const EMPTY_GAMES: GameDto[] = []

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

      {/* §4.2: герой гостя — spinera; залогиненному маркетингового героя нет (§4.3) */}
      {!user && <GuestHero games={popular} />}

      {/* §4.4: GameDeck у гостя (после Hero) */}
      {!user && (
        <GameDeck games={popular} favoriteSlugs={favoriteSlugs} onToggleFavorite={toggleFavorite} />
      )}

      {user && (
        <GameSection
          title="Продолжить играть"
          capsLabel="ТВОЯ ИСТОРИЯ"
          actionHref="/history"
          actionLabel="Вся история"
          games={recent ?? EMPTY_GAMES}
          variant="row"
          favoriteSlugs={favoriteSlugs}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {/* §4.4: GameDeck у залогиненного (после «Продолжить играть») */}
      {user && (
        <GameDeck
          games={popular}
          recentGames={recent ?? EMPTY_GAMES}
          favoriteSlugs={favoriteSlugs}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {user && <HomeChips categories={categories} />}

      <GameSection
        title={user ? 'Популярное сейчас' : 'Популярные'}
        capsLabel="ГОРЯЧО СЕЙЧАС"
        actionHref="/casino"
        actionLabel="Весь каталог"
        games={popular}
        favoriteSlugs={favoriteSlugs}
        onToggleFavorite={toggleFavorite}
      />

      <GameSection
        title="Новые игры"
        capsLabel="СВЕЖИЕ ПОСТУПЛЕНИЯ"
        actionHref="/casino?sort=new"
        actionLabel="Все новые"
        games={fresh}
        favoriteSlugs={favoriteSlugs}
        onToggleFavorite={toggleFavorite}
      />

      {user && (
        <GameSection
          title="Избранное"
          capsLabel="ТВОЙ СПИСОК"
          actionHref="/favorites"
          actionLabel="Смотреть все"
          games={favoriteGames}
          favoriteSlugs={favoriteSlugs}
          onToggleFavorite={toggleFavorite}
        />
      )}

      <ProviderStrip providers={providers} />
    </div>
  )
}
