import type { CatalogCategory } from '@/lib/ui/catalog-filters'
import type { GameDto, ProviderDto } from '@/types/casino'

/**
 * GAP-55 (е) (ТЗ §20/§22: «каталог и главная — ISR», «ISR главной 60 секунд»).
 * Серверное чтение публичных данных для static/ISR-рендера главной.
 *
 * URL — NEXT_PUBLIC_API_URL: он же годится для серверного хода (в проде это
 * публичный https-адрес API). Свою переменную не заводим, чтобы не плодить
 * расхождение с docs-guard D3/D7 (каждый ключ env обязан быть в .env.example
 * и ENVIRONMENT_VARIABLES §22).
 *
 * Ошибки НЕ пробрасываем: страница с пустыми полками лучше страницы, на которой
 * `next build` упал на prerender (в CI API не поднят, и на деплое API может
 * отставать от фронта).
 */
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1'

/** §22: главная переживает себя раз в минуту. */
export const HOME_REVALIDATE_SECONDS = 60

interface Envelope<T> {
  data: T
}

async function getJson<T>(path: string, params: Record<string, string | number> = {}): Promise<T | null> {
  const query = new URLSearchParams(
    Object.entries({ ...params }).map(([key, value]) => [key, String(value)]),
  ).toString()
  const url = `${API_URL}${path}${query.length > 0 ? `?${query}` : ''}`
  try {
    const response = await fetch(url, { next: { revalidate: HOME_REVALIDATE_SECONDS } })
    if (!response.ok) {
      return null
    }
    const body = (await response.json()) as Envelope<T> | T
    return ((body as Envelope<T>).data ?? body) as T
  } catch {
    return null
  }
}

export async function fetchGamesServer(params: Record<string, string | number>): Promise<GameDto[]> {
  const page = await getJson<{ data: GameDto[] }>('/casino/games', params)
  return page?.data ?? []
}

export async function fetchProvidersServer(): Promise<ProviderDto[]> {
  return (await getJson<ProviderDto[]>('/casino/providers')) ?? []
}

export async function fetchCategoriesServer(): Promise<CatalogCategory[]> {
  return (await getJson<CatalogCategory[]>('/casino/categories')) ?? []
}
