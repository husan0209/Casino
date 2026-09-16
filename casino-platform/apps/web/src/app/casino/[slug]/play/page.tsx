'use client'

import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

import { formatBalance } from '@/lib/format/currency'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

/** §22: iframe провайдера — отдельным чанком, без SSR-части (§8.3, §22). */
const GameFrame = dynamic(
  () => import('@/components/game/GameFrame').then((module) => module.GameFrame),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Загрузка игры…
      </div>
    ),
  },
)

export default function GamePlayPage(): React.JSX.Element {
  const params = useSearchParams()
  const router = useRouter()
  const url = params.get('url')
  const { getActiveWallet, activeCurrency, refreshActive } = useWalletStore()
  const { openDeposit } = useUIStore()
  const wallet = getActiveWallet()

  // §8.3: баланс на планке живой — refetch по возврату фокуса окна
  // (Socket.IO в релизе запрещён §2.1)
  useEffect(() => {
    const onFocus = (): void => {
      void refreshActive()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshActive])

  if (!url) {
    return <div className="container-1 py-8 text-muted">Игра не найдена</div>
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0F0F1A]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#2A2A4A] px-3">
        <button
          type="button"
          onClick={() => {
            void refreshActive()
            router.push('/')
          }}
          aria-label="Выйти из игры"
          className="text-xl"
        >
          ×
        </button>
        <span className="text-sm font-medium">
          {formatBalance(wallet?.available ?? '0', activeCurrency)}
        </span>
        <button
          type="button"
          className="btn-money px-3 py-1 text-sm"
          onClick={() => openDeposit(activeCurrency)}
        >
          +
        </button>
      </div>
      {/* decodeURIComponent: url приезжает закодированным из launch-flow */}
      <GameFrame url={decodeURIComponent(url)} />
    </div>
  )
}
