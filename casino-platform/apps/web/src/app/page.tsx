'use client'
import { useQuery } from '@tanstack/react-query'

import { GameCard } from '@/components/casino/GameCard'
import { apiGet } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import type { GameDto, GamesListDto } from '@/types/casino'
import { useUIStore } from '@/stores/ui'

export default function Home() {
  const { user } = useAuth()
  const { openLogin } = useUIStore()

  const { data, isLoading } = useQuery({
    queryKey: ['games-home'],
    queryFn: () => apiGet<GamesListDto | GameDto[]>('/casino/games?per_page=12&sort=popular'),
    retry: false,
  })

  const games: GameDto[] = Array.isArray(data) ? data : (data?.data ?? [])

  const fallback = [
    { slug: 'demo-sweet-fruits', name: 'Sweet Fruits', provider: { name: 'Demo' } },
    { slug: 'demo-lucky-sevens', name: 'Lucky Sevens', provider: { name: 'Demo' } },
    { slug: 'demo-book-of-demo', name: 'Book of Demo', provider: { name: 'Demo' } },
  ]

  const list = games.length ? games : fallback

  return (
    <div className="container-1 py-4">
      {!user && (
        <section className="mb-4 rounded-2xl border border-[#2A2A4A] bg-gradient-to-br from-[#16213E] to-[#1A1A2E] p-4">
          <h1 className="text-xl font-bold">Слоты онлайн</h1>
          <p className="mt-1 text-sm text-muted">Тап по игре — и в дело</p>
        </section>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{user ? 'Популярные' : 'Популярные слоты'}</h2>
      </div>

      {isLoading ? (
        <div className="text-muted py-8 text-center text-sm">Загрузка игр…</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {list.slice(0, 12).map((g, i) => (
            <GameCard
              key={g.slug || i}
              slug={g.slug}
              name={g.name_ru || g.name}
              provider={g.provider?.name || 'Demo'}
              onPlay={() => {
                if (!user) {
                  openLogin(g.slug)
                } else {
                  window.location.href = `/casino/${g.slug}?launch=1`
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
