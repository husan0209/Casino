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

/** Игра в каталоге (поля из Prisma Game + provider). */
export interface GameDto {
  id: string
  slug: string
  name: string
  name_ru?: string | null
  category?: string | null
  rtp?: number | null
  is_new?: boolean
  is_popular?: boolean
  launch_count?: number
  provider?: GameProviderDto | null
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

/** Ответ GET /casino/games/:slug ( карточка игры для запуска). */
export interface GameDetailsDto extends GameDto {
  has_demo?: boolean
}

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

export interface HistoryDto {
  data: HistoryRowDto[]
  total: number
}
