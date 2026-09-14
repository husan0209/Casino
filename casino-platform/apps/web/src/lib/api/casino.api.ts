/**
 * GAP-52 (ТЗ ч.5 §6.1/§7): API-домен витрины — recent (Продолжить играть)
 * и favorites (избранное). Мутации избранного — optimistic update на странице.
 */
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { FavoritesListDto, ProviderDto, RecentGameDto } from '@/types/casino'

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
