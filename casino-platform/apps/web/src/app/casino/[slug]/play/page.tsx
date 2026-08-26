'use client'
import { useSearchParams, useRouter } from 'next/navigation'

import { formatBalance } from '@/lib/format/currency'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

export default function GamePlayPage() {
  const params = useSearchParams()
  const router = useRouter()
  const url = params.get('url')
  const { getActiveWallet, activeCurrency, refreshActive } = useWalletStore()
  const { openDeposit } = useUIStore()
  const wallet = getActiveWallet()

  if (!url) {
    return <div className="container-1 py-8 text-muted">Игра не найдена</div>
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0F0F1A]">
      <div className="flex h-12 items-center justify-between border-b border-[#2A2A4A] px-3">
        <button type="button" onClick={() => { void refreshActive(); router.push('/') }} className="text-xl">×</button>
        <span className="text-sm font-medium">{formatBalance(wallet?.available ?? '0', activeCurrency)}</span>
        <button type="button" className="btn-money px-3 py-1 text-sm" onClick={() => openDeposit(activeCurrency)}>+</button>
      </div>
      <iframe src={decodeURIComponent(url)} className="flex-1 w-full border-0" allow="fullscreen" />
    </div>
  )
}
