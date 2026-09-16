/**
 * GAP-52 (ТЗ ч.5 §6.1/§7): API-домен витрины — recent (Продолжить играть)
 * и favorites (избранное). Мутации избранного — optimistic update на странице.
 */
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import { type CatalogCategory, filtersToApiParams, type CatalogFilters } from '@/lib/ui/catalog-filters'
import type { FavoritesListDto, GamesListDto, ProviderDto, RecentGameDto } from '@/types/casino'

/** Категории с наполнением (§7: пустые разделы не показываем). */
export function fetchCategories(): Promise<CatalogCategory[]> {
  return apiGet<CatalogCategory[]>('/casino/categories')
}

/** Страница каталога по фильтрам из URL (§7). */
export function fetchGamesPage(
  page: number,
  filters: CatalogFilters,
  perPage = 24,
): Promise<GamesListDto> {
  return apiGet<GamesListDto>('/casino/games', {
    page,
    per_page: perPage,
    ...filtersToApiParams(filters),
  })
}

/** Каталог провайдеров (GET /casino/providers). */
export function fetchProviders(): Promise<ProviderDto[]> {
  return apiGet<ProviderDto[]>('/casino/providers')
}

/** Последние сыгранные игры (GET /casino/recent, до 20). */
export function fetchRecentGames(): Promise<RecentGameDto[]> {
  return apiGet<RecentGameDto[]>('/casino/recent')
}

export function fetchFavoriteGames(page = 1, perPage = 24): Promise<FavoritesListDto> {
  return apiGet<FavoritesListDto>('/casino/favorites', { page, per_page: perPage })
}

export function addFavorite(slug: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/casino/games/${slug}/favorite`)
}

export function removeFavorite(slug: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/casino/games/${slug}/favorite`)
}
