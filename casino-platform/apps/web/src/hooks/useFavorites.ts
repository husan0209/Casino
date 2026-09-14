'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { toast } from '@/components/ui/toaster'
import { errText } from '@/lib/api'
import { addFavorite, fetchFavoriteGames, removeFavorite } from '@/lib/api/casino.api'
import { useAuth } from '@/stores/auth'
import type { FavoritesListDto, GameDto } from '@/types/casino'

const FAVORITES_KEY = ['favorites-ids']

/**
 * GAP-55 (ТЗ ч.5 §18): избранное — server-state (TanStack Query) с
 * optimistic update: сердце переключается сразу (onMutate правит кеш),
 * при отказе сервера откатываем захваченный снимок и показываем ошибку;
 * onSettled приводит кеш к серверной правде.
 */
export function useFavorites(): {
  favoriteGames: GameDto[]
  favoriteSlugs: Set<string>
  toggleFavorite: (game: GameDto) => void
  isPending: boolean
} {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: FAVORITES_KEY,
    queryFn: () => fetchFavoriteGames(1, 100),
    enabled: Boolean(user),
    staleTime: 60_000,
  })

  // favoriteGames — тоже через useMemo: иначе `data?.data ?? []` создаёт новый
  // массив каждый рендер и useMemo ниже (и все потребители Set) не стабильны
  // (react-hooks/exhaustive-deps, найдено CI).
  const favoriteGames = useMemo(() => data?.data ?? [], [data])
  const favoriteSlugs = useMemo(
    () => new Set(favoriteGames.map((game) => game.slug)),
    [favoriteGames],
  )

  const mutation = useMutation({
    mutationFn: ({ game, next }: { game: GameDto; next: boolean }) =>
      next ? addFavorite(game.slug) : removeFavorite(game.slug),
    onMutate: async ({ game, next }) => {
      await queryClient.cancelQueries({ queryKey: FAVORITES_KEY })
      const previous = queryClient.getQueryData<FavoritesListDto>(FAVORITES_KEY)
      if (previous) {
        const without = previous.data.filter((item) => item.slug !== game.slug)
        queryClient.setQueryData<FavoritesListDto>(FAVORITES_KEY, {
          ...previous,
          data: next ? [game, ...without] : without,
        })
      }
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(FAVORITES_KEY, context.previous)
      }
      toast.error(errText(error) || 'Не удалось обновить избранное')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: FAVORITES_KEY })
      void queryClient.invalidateQueries({ queryKey: ['favorites-page'] })
    },
  })

  const toggleFavorite = (game: GameDto): void => {
    if (!user) {
      return
    }
    mutation.mutate({ game, next: !favoriteSlugs.has(game.slug) })
  }

  return { favoriteGames, favoriteSlugs, toggleFavorite, isPending: mutation.isPending }
}
