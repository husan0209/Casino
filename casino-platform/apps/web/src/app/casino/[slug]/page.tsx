'use client'
import { useMutation, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

import { toast } from '@/components/ui/toaster'
import { apiGet, apiPost, errCode, errText } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'
import type { GameDetailsDto, GameLaunchDto } from '@/types/casino'

export default function GamePage(): React.JSX.Element {
  const { slug } = useParams() as { slug: string }
  const search = useSearchParams()
  const shouldLaunch = search.get('launch') === '1'
  const { user } = useAuth()
  const { openLogin, openDeposit } = useUIStore()
  const { activeCurrency, fetchWallets, setLastPlayed } = useWalletStore()
  const { config, load } = useGeoStore()

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
      if (code === 'CURRENCY_NOT_SUPPORTED') {
        toast.error('Эта игра не поддерживает выбранную валюту')
        return
      }
      toast.error(errText(e))
    },
  })

  useEffect(() => {
    void load()
    if (user) {
      void fetchWallets()
    }
  }, [user, load, fetchWallets])

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
    </div>
  )
}
