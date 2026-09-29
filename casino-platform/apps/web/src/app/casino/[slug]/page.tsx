'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { Heart, Play, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { GameCard } from '@/components/casino/GameCard'
import { GameThumb } from '@/components/casino/GameThumb'
import { LaunchErrorScreen } from '@/components/game/LaunchErrorScreen'
import { useFavorites } from '@/hooks/useFavorites'
import { apiGet, apiPost, errCode, errIsNetwork, errStatus } from '@/lib/api'
import { fetchGamesPage } from '@/lib/api/casino.api'
import { EMPTY_FILTERS } from '@/lib/ui/catalog-filters'
import { gameDisplayName, gameHasDemo, gameRtpLabel } from '@/lib/ui/game'
import {
  describeLaunchError,
  type LaunchErrorAction,
  type LaunchErrorView,
} from '@/lib/ui/launch-error'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'
import type { GameDetailsDto, GameDto, GameLaunchDto } from '@/types/casino'

/**
 * ТЗ ч.5 §8.1: превью игры /casino/[slug]
 * - обложка, название, провайдер;
 * - RTP / характеристики;
 * - кнопки «Играть» и «Демо»;
 * - избранное;
 * - блок «Похожие игры».
 */
export default function GamePage(): React.JSX.Element {
  const { slug } = useParams() as { slug: string }
  const router = useRouter()
  const search = useSearchParams()
  const shouldLaunch = search.get('launch') === '1'
  const { user } = useAuth()
  const { openLogin, openDeposit, openWalletSwitcher } = useUIStore()
  const { activeCurrency, fetchWallets, setLastPlayed } = useWalletStore()
  const { config, load } = useGeoStore()
  const { favoriteSlugs, toggleFavorite } = useFavorites()
  const [failure, setFailure] = useState<{ view: LaunchErrorView; code?: string } | null>(null)
  const launchedKeyRef = useRef<string | null>(null)

  const currency = config?.activeCurrency ?? activeCurrency

  const { data: game } = useQuery({
    queryKey: ['game', slug],
    queryFn: () => apiGet<GameDetailsDto>(`/casino/games/${slug}`),
  })

  // Похожие игры провайдера / каталога
  const providerSlug = game?.provider?.slug
  const { data: similarGames } = useQuery({
    queryKey: ['similar-games', providerSlug],
    queryFn: () => fetchGamesPage(1, { ...EMPTY_FILTERS, provider: providerSlug ?? '' }, 6),
    enabled: Boolean(providerSlug),
  })

  const launch = useMutation({
    mutationFn: () =>
      apiPost<GameLaunchDto>(`/casino/games/${slug}/launch`, {
        currency,
        return_url: window.location.href,
      }),
    onSuccess: (res) => {
      setLastPlayed(slug, currency)
      window.location.href = `/casino/${slug}/play?url=${encodeURIComponent(res.launch_url)}`
    },
    onError: (e: unknown) => {
      const code = errCode(e)
      if (code === 'INSUFFICIENT_FUNDS') {
        openDeposit(currency)
        return
      }
      setFailure({
        view: describeLaunchError({ code, status: errStatus(e), network: errIsNetwork(e) }),
        ...(code !== undefined ? { code } : {}),
      })
    },
  })

  useEffect(() => {
    void load()
    if (user) {
      void fetchWallets()
    }
  }, [user, load, fetchWallets])

  useEffect(() => {
    setFailure(null)
    launchedKeyRef.current = null
  }, [slug, currency])

  useEffect(() => {
    if (!user) {
      if (shouldLaunch) {
        openLogin(slug)
      }
      return
    }
    if (shouldLaunch && game && !launch.isPending && !launch.isSuccess) {
      const key = `${slug}:${currency}`
      if (launchedKeyRef.current !== key) {
        launchedKeyRef.current = key
        launch.mutate()
      }
    }
  }, [user, shouldLaunch, game, slug, currency, openLogin, launch])

  if (!game) {
    return <div className="container-1 py-12 text-center text-muted">Загрузка игры…</div>
  }

  const displayName = gameDisplayName(game)
  const isFav = favoriteSlugs.has(game.slug)
  const rtp = gameRtpLabel(game.rtp)
  const hasDemo = gameHasDemo(game.hasDemo)

  return (
    <div className="container-1 py-6">
      {/* Хлебные крошки */}
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-muted">
        <Link href="/" className="hover:text-white">
          Главная
        </Link>
        <span>/</span>
        <Link href="/casino" className="hover:text-white">
          Каталог
        </Link>
        <span>/</span>
        <span className="text-white/80">{displayName}</span>
      </nav>

      {/* Главная карточка игры */}
      <div className="card overflow-hidden p-0 border-[#2A2A4A]/60">
        <div className="grid md:grid-cols-12">
          {/* Обложка игры */}
          <div className="relative aspect-[4/3] bg-gradient-to-br from-[#22223a] to-[#111122] md:col-span-5 md:aspect-auto">
            <GameThumb src={game.thumbnailUrl} alt={displayName} />
            <div className="absolute inset-0 bg-gradient-to-t from-[#16213E] via-transparent to-transparent md:hidden" />
          </div>

          {/* Детали и действия */}
          <div className="flex flex-col justify-between p-6 md:col-span-7">
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">
                    {displayName}
                  </h1>
                  <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                    <span>{game.provider?.name || 'Провайдер'}</span>
                    <span>•</span>
                    <span className="rounded bg-white/5 px-2 py-0.5 text-xs font-semibold text-white/70">
                      Слот
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => toggleFavorite(game)}
                  aria-label={isFav ? 'Удалить из избранного' : 'Добавить в избранное'}
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#2A2A4A] transition ${
                    isFav
                      ? 'border-[#FF3D71]/40 bg-[#FF3D71]/10 text-[#FF3D71]'
                      : 'text-muted hover:border-white/20 hover:text-white'
                  }`}
                >
                  <Heart size={20} className={isFav ? 'fill-current' : ''} />
                </button>
              </div>

              {/* Характеристики */}
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white/[0.03] p-3 border border-[#2A2A4A]/40">
                  <div className="text-[11px] font-medium text-muted">Отдача (RTP)</div>
                  <div className="mt-0.5 text-base font-bold text-[#00E676]">{rtp || '96.5%'}</div>
                </div>
                <div className="rounded-xl bg-white/[0.03] p-3 border border-[#2A2A4A]/40">
                  <div className="text-[11px] font-medium text-muted">Волатильность</div>
                  <div className="mt-0.5 text-base font-bold text-white">Высокая</div>
                </div>
                <div className="rounded-xl bg-white/[0.03] p-3 border border-[#2A2A4A]/40 col-span-2 sm:col-span-1">
                  <div className="text-[11px] font-medium text-muted">Лицензия</div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-white/90">
                    <Sparkles size={14} className="text-[#FFB300]" />
                    Оригинал
                  </div>
                </div>
              </div>
            </div>

            {/* Кнопки запуска */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {user ? (
                <button
                  disabled={launch.isPending}
                  onClick={() => launch.mutate()}
                  className="btn-money flex-1 py-3.5 text-base font-bold"
                >
                  <Play size={18} className="fill-current" />
                  {launch.isPending ? 'Запуск игры…' : 'Играть на деньги'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-money flex-1 py-3.5 text-base font-bold"
                  onClick={() => openLogin(slug)}
                >
                  Войти, чтобы играть
                </button>
              )}

              {hasDemo && (
                <button
                  type="button"
                  className="btn-ghost py-3.5 px-6 font-semibold"
                  onClick={async () => {
                    const res = await apiPost<GameLaunchDto>(`/casino/games/${slug}/demo`, {
                      currency,
                    })
                    if (res.launch_url) {
                      window.open(res.launch_url, '_blank')
                    }
                  }}
                >
                  Демо-режим
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Ошибки запуска экраном */}
      {failure && (
        <div className="mt-6">
          <LaunchErrorScreen
            view={failure.view}
            code={failure.code}
            onAction={(action: LaunchErrorAction) => {
              if (action === 'retry') {
                setFailure(null)
                launch.mutate()
                return
              }
              if (action === 'deposit') {
                openDeposit(currency)
                return
              }
              if (action === 'switch_currency') {
                openWalletSwitcher()
                return
              }
              setFailure(null)
              router.push(action === 'support' ? '/support' : '/casino')
            }}
          />
        </div>
      )}

      {/* Похожие игры */}
      {similarGames && similarGames.data && similarGames.data.length > 0 && (
        <div className="mt-10">
          <p className="caps-label">ПОХОЖИЕ СЛОТЫ</p>
          <h2 className="section-title mb-4">Ещё от этого провайдера</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {(similarGames?.data ?? [])
              .filter((g: GameDto) => g.slug !== slug)
              .slice(0, 6)
              .map((g: GameDto) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  isFavorite={favoriteSlugs.has(g.slug)}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
