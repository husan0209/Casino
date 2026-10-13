'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { Heart, Play } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { GameCard } from '@/components/casino/GameCard'
import { GameThumb } from '@/components/casino/GameThumb'
import { LaunchErrorScreen } from '@/components/game/LaunchErrorScreen'
import { useDemoLaunch } from '@/hooks/useDemoLaunch'
import { useFavorites } from '@/hooks/useFavorites'
import { apiGet, apiPost, errCode, errIsNetwork, errStatus } from '@/lib/api'
import { fetchGamesPage } from '@/lib/api/casino.api'
import { EMPTY_FILTERS } from '@/lib/ui/catalog-filters'
import { gameDisplayName, gameHasDemo, gameMinBetLabel, gameVolatilityLabel } from '@/lib/ui/game'
import { realMoneyStep } from '@/lib/ui/game-launch'
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

function SimilarGamesSection({
  games,
  slug,
  favoriteSlugs,
  onToggleFavorite,
}: {
  games: GameDto[]
  slug: string
  favoriteSlugs: Set<string>
  onToggleFavorite: (g: GameDto) => void
}): React.JSX.Element | null {
  const filtered = games.filter((g) => g.slug !== slug).slice(0, 6)
  if (filtered.length === 0) {
    return null
  }

  return (
    <div className="mt-10">
      <p className="caps-label">ПОХОЖИЕ СЛОТЫ</p>
      <h2 className="section-title mb-4">Ещё от этого провайдера</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {filtered.map((g) => (
          <GameCard
            key={g.slug}
            game={g}
            isFavorite={favoriteSlugs.has(g.slug)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Плитки характеристик только из данных каталога. Пустое поле не показываем:
 * выдуманную «Волатильность: Высокая» игрок читает как факт об игре, а фактов
 * о чужих слотах у нас нет — как и с RTP, витрина не имеет права обещать то,
 * чего сервер не считает.
 */
function GameSpecs({
  minBet,
  volatility,
  currency,
}: {
  minBet: GameDto['minBet']
  volatility: string | null | undefined
  currency: string
}): React.JSX.Element | null {
  const specs = [
    { label: 'Мин. ставка', value: gameMinBetLabel(minBet, currency) },
    { label: 'Волатильность', value: gameVolatilityLabel(volatility) },
  ].filter((spec): spec is { label: string; value: string } => spec.value !== null)

  if (specs.length === 0) {
    return null
  }

  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {specs.map((spec) => (
        <div key={spec.label} className="rounded-xl bg-white/[0.03] p-3 border border-[#2A2A4A]/40">
          <div className="text-[11px] font-medium text-muted">{spec.label}</div>
          <div className="mt-0.5 text-base font-bold text-white">{spec.value}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * Кнопки запуска страницы игры (§8.1): «Играть на деньги» / «Войти, чтобы играть»
 * и «Демо-режим». Наружу — потому что внутри GamePage они занимали треть бюджета
 * строк функции, а разметка здесь декларативная и своей логики не имеет.
 */
function GameActions({
  signedIn,
  launching,
  demoLoading,
  hasDemo,
  onPlay,
  onDemo,
  onLogin,
}: {
  signedIn: boolean
  launching: boolean
  demoLoading: boolean
  hasDemo: boolean
  onPlay: () => void
  onDemo: () => void
  onLogin: () => void
}): React.JSX.Element {
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      {signedIn ? (
        <button
          type="button"
          disabled={launching}
          onClick={onPlay}
          className="btn-money flex-1 py-3.5 text-base font-bold"
        >
          <Play size={18} className="fill-current" />
          {launching ? 'Запуск игры…' : 'Играть на деньги'}
        </button>
      ) : (
        <button
          type="button"
          className="btn-money flex-1 py-3.5 text-base font-bold"
          onClick={onLogin}
        >
          Войти, чтобы играть
        </button>
      )}

      {hasDemo && (
        <button
          type="button"
          className="btn-ghost py-3.5 px-6 font-semibold"
          disabled={demoLoading}
          onClick={onDemo}
        >
          {demoLoading ? 'Запуск демо…' : 'Демо-режим'}
        </button>
      )}
    </div>
  )
}

export default function GamePage(): React.JSX.Element {
  const { slug } = useParams() as { slug: string }
  const router = useRouter()
  const search = useSearchParams()
  const shouldLaunch = search.get('launch') === '1'
  const { user } = useAuth()
  const { openLogin, openDeposit, openWalletSwitcher } = useUIStore()
  const { activeCurrency, fetchWallets, getActiveWallet, getLaunchBalance, setLastPlayed } =
    useWalletStore()
  const { load } = useGeoStore()
  const { favoriteSlugs, toggleFavorite } = useFavorites()
  const [failure, setFailure] = useState<{ view: LaunchErrorView; code?: string } | null>(null)
  const launchedKeyRef = useRef<string | null>(null)

  // Валюта запуска = валюта активного кошелька. `config.activeCurrency` — фиат из
  // гео-конфига, с ним игрок с активным USDT крутил бы спины рублями.
  const currency = getActiveWallet()?.currency ?? activeCurrency

  const { data: game } = useQuery({
    queryKey: ['game', slug],
    queryFn: () => apiGet<GameDetailsDto>(`/casino/games/${slug}`),
  })

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
        openDeposit(currency, slug)
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

  const { startDemo, isRunning: demoLoading } = useDemoLaunch()

  // Пустой кошелёк — касса сразу, без попытки запуска: тот же `realMoneyStep`,
  // что в шторке витрины и в колоде (§8.2). Серверная ветка `INSUFFICIENT_FUNDS`
  // остаётся запасным путём (возврат из депозита, гонка балансов).
  const playReal = (): void => {
    const step = realMoneyStep({ signedIn: true, balance: getLaunchBalance() })
    if (step === 'deposit') {
      openDeposit(currency, slug)
      return
    }
    launch.mutate()
  }

  useEffect(() => {
    setFailure(null)
    launchedKeyRef.current = null
  }, [slug, currency])

  /**
   * Авто-запуск по `?launch=1`. Два стража, и оба нужны:
   * - `launching`/`launched`/`launchMutate` вынуты из объекта мутации: сам он
   *   создаётся заново на каждый рендер, и как зависимость эффекта превращал
   *   эффект в бесконечный цикл (React: «Maximum update depth exceeded»);
   * - `loginAskedRef` — гостю лист входа предлагается один раз на игру, а не на
   *   каждый рендер.
   */
  const launching = launch.isPending
  const launched = launch.isSuccess
  const launchMutate = launch.mutate
  const loginAskedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user) {
      if (shouldLaunch && loginAskedRef.current !== slug) {
        loginAskedRef.current = slug
        openLogin(slug)
      }
      return
    }
    if (shouldLaunch && game && !launching && !launched) {
      const key = `${slug}:${currency}`
      if (launchedKeyRef.current !== key) {
        launchedKeyRef.current = key
        launchMutate()
      }
    }
  }, [user, shouldLaunch, game, slug, currency, openLogin, launching, launched, launchMutate])

  if (!game) {
    return <div className="container-1 py-12 text-center text-muted">Загрузка игры…</div>
  }

  const displayName = gameDisplayName(game)
  const isFav = favoriteSlugs.has(game.slug)
  const hasDemo = gameHasDemo(game.hasDemo)

  return (
    <div className="container-1 py-6">
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

      <div className="card overflow-hidden p-0 border-[#2A2A4A]/60">
        <div className="grid md:grid-cols-12">
          <div className="relative aspect-[4/3] bg-gradient-to-br from-[#22223a] to-[#111122] md:col-span-5 md:aspect-auto">
            <GameThumb src={game.thumbnailUrl} alt={displayName} />
            <div className="absolute inset-0 bg-gradient-to-t from-[#16213E] via-transparent to-transparent md:hidden" />
          </div>

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

              <GameSpecs minBet={game.minBet} volatility={game.volatility} currency={currency} />
            </div>

            <GameActions
              signedIn={user !== null}
              launching={launch.isPending}
              demoLoading={demoLoading}
              hasDemo={hasDemo}
              onPlay={playReal}
              onDemo={() => void startDemo(slug, currency)}
              onLogin={() => openLogin(slug)}
            />
          </div>
        </div>
      </div>

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
                openDeposit(currency, slug)
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

      <SimilarGamesSection
        games={similarGames?.data ?? []}
        slug={slug}
        favoriteSlugs={favoriteSlugs}
        onToggleFavorite={toggleFavorite}
      />
    </div>
  )
}
