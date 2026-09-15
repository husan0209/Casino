'use client'
import { useMutation, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { LaunchErrorScreen } from '@/components/game/LaunchErrorScreen'
import { apiGet, apiPost, errCode, errIsNetwork, errStatus } from '@/lib/api'
import { describeLaunchError, type LaunchErrorAction, type LaunchErrorView } from '@/lib/ui/launch-error'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'
import type { GameDetailsDto, GameLaunchDto } from '@/types/casino'

/**
 * GAP-55 (в) (ТЗ §8.4): ошибки запуска — экран с следующим шагом, а не toast.
 * INSUFFICIENT_FUNDS исключением не является, но это не ошибка, а флоу (§8.2.4:
 * «все кошельки пусты → DepositSheet»), поэтому он ведёт в кассу сразу.
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
  const [failure, setFailure] = useState<{ view: LaunchErrorView; code?: string } | null>(null)

  const currency = config?.activeCurrency ?? activeCurrency

  const { data: game } = useQuery({
    queryKey: ['game', slug],
    queryFn: () => apiGet<GameDetailsDto>(`/casino/games/${slug}`),
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

  // Сменили игру или кошелёк — прошлая ошибка больше не актуальна (§8.2 п.7: повторный
  // заход в ту же игру идёт сразу, без повтора ошибки)
  useEffect(() => {
    setFailure(null)
  }, [slug, currency])

  useEffect(() => {
    if (!user) {
      if (shouldLaunch) {
        openLogin(slug)
      }
      return
    }
    if (shouldLaunch && game && !launch.isPending && !launch.isSuccess) {
      launch.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `launch` исключён намеренно: его изменение вызывало бы повторные mutate после ошибки
  }, [user, shouldLaunch, game, slug, openLogin])

  if (!game) {
    return <div className="container-1 py-8 text-muted">Загрузка…</div>
  }

  return (
    <div className="container-1 py-6">
      <div className="mb-2 text-sm text-muted">
        <Link href="/casino">Каталог</Link> / {game.name_ru || game.name}
      </div>
      <div className="card space-y-3">
        <h1 className="text-xl font-bold">{game.name_ru || game.name}</h1>
        <div className="text-sm text-muted">{game.provider?.name}</div>
        {game.rtp && <div className="text-sm">RTP {game.rtp}%</div>}
        {user ? (
          <button
            disabled={launch.isPending}
            onClick={() => launch.mutate()}
            className="btn w-full"
          >
            {launch.isPending ? 'Запуск…' : 'Играть'}
          </button>
        ) : (
          <button type="button" className="btn w-full" onClick={() => openLogin(slug)}>
            Войти чтобы играть
          </button>
        )}
        {game.has_demo && (
          <button
            type="button"
            className="btn-ghost w-full"
            onClick={async () => {
              const res = await apiPost<GameLaunchDto>(`/casino/games/${slug}/demo`, { currency })
              if (res.launch_url) {
                window.open(res.launch_url, '_blank')
              }
            }}
          >
            Демо
          </button>
        )}
      </div>

      {failure && (
        <div className="mt-4">
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
    </div>
  )
}
