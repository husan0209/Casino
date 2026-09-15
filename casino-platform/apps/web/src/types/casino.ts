/**
 * DTO casino-раздела (контракт GET /casino/*).
 * Форма соответствует TransformInterceptor {success, data} — apiGet<T>
 * разворачивает конверт и возвращает T.
 */

/** Провайдер игр. */
export interface GameProviderDto {
  id: string
  slug: string
  name: string
}

/** Ответ GET /casino/providers (snake_case — маппинг в контроллере). */
export interface ProviderDto {
  slug: string
  name: string
  logo_url: string | null
  game_count: number
  type: string
}

/**
 * Игра в каталоге. Поля — в camelCase, как их отдаёт ListGamesUseCase (select полей
 * Prisma) и эндпоинты /casino/favorites и /casino/recent (целиком Prisma Game):
 * nameRu / isNew / isPopular / hasDemo / thumbnailUrl.
 *
 * GAP-55: раньше DTO был описан в snake_case (name_ru / is_new / has_demo), но API
 * таких ключей не отдаёт — из-за этого бейджи NEW/HOT и кнопка «Демо» не рендерились.
 * rtp на бэке — Prisma.Decimal, в JSON приходит строкой.
 */
export interface GameDto {
  id: string
  slug: string
  name: string
  nameRu?: string | null
  thumbnailUrl?: string | null
  category?: string | null
  rtp?: number | string | null
  isFeatured?: boolean
  isNew?: boolean
  isPopular?: boolean
  hasDemo?: boolean
  volatility?: string | null
  provider?: GameProviderDto | null
}

/** Ответ GET /casino/categories — категория с числом игр (пустые не показываем, ТЗ §7). */
export interface CatalogCategoryDto {
  slug: string
  name: string
  game_count: number
}

/** Пагинация листинга игр (ListGamesUseCase meta). */
export interface GamesMetaDto {
  page: number
  perPage: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

/** Ответ GET /casino/games. */
export interface GamesListDto {
  data: GameDto[]
  meta: GamesMetaDto
}

/** Ответ GET /casino/games/:slug — та же игра + поле демо (hasDemo уже в GameDto). */
export interface GameDetailsDto extends GameDto {}

/** Ответ POST /casino/games/:slug/launch. */
export interface GameLaunchDto {
  launch_url: string
  session_id: string
}

/** Ответ GET /casino/history. */
export interface HistoryRowDto {
  round_id: string
  game: { slug: string; name: string; provider: string }
  currency: string
  total_bet: string
  total_win: string
  profit: string
  status: string
  created_at: string
}

/** Строка итогов по одной валюте (GAP-55 (д), ТЗ §12: деньги — строки). */
export interface HistoryStatsDto {
  currency: string
  rounds: number
  turnover: string
  wins: string
}

/** Ответ GET /casino/history (GAP-55: пагинация + агрегаты по валютам). */
export interface HistoryDto {
  data: HistoryRowDto[]
  meta: {
    page: number
    per_page: number
    total: number
    total_pages: number
  }
  stats: HistoryStatsDto[]
}

/** Игра в списке «Продолжить играть» (GET /casino/recent — FavoriteWithGame['game']). */
export interface RecentGameDto extends GameDto {}

/** Ответ GET /casino/favorites — те же поля игры + provider. */
export interface FavoritesListDto {
  data: GameDto[]
  meta: GamesMetaDto
}
