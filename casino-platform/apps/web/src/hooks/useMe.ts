import { useQuery } from '@tanstack/react-query'

import { apiGet } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import type { MeDto } from '@/types/user'

/**
 * Общее «я + профиль» (GET /users/me) для шапки, таб-бара и кабинета:
 * один react-query-кеш по ключу ['me'] — профиль страницы и аватары
 * хедера/таб-бара читают одни и те же данные без лишних запросов.
 */
export function useMe(): { me: MeDto | null; isLoading: boolean } {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet<MeDto>('/users/me'),
    enabled: Boolean(user),
  })
  return { me: query.data ?? null, isLoading: query.isLoading }
}
