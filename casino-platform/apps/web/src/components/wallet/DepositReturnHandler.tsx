'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { pollDepositStatus } from '@/lib/api/wallet.api'
import { useWalletStore } from '@/stores/wallet'
import { useUIStore } from '@/stores/ui'
import { formatAmount } from '@/lib/format/currency'

const PAYMENT_KEY = 'casino_pending_payment_id'
const GAME_KEY = 'casino_pending_game_slug'

export function saveDepositContext(paymentId: string, gameSlug?: string | null) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(PAYMENT_KEY, paymentId)
  if (gameSlug) sessionStorage.setItem(GAME_KEY, gameSlug)
}

export function DepositReturnHandler() {
  const router = useRouter()
  const { fetchWallets } = useWalletStore()
  const { pendingGameSlug } = useUIStore()
  const [success, setSuccess] = useState<{ amount: string; currency: string; gameSlug: string | null } | null>(null)
  const polled = useRef(false)

  useEffect(() => {
    if (polled.current || typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const depositParam = params.get('deposit')
    if (depositParam !== 'success' && depositParam !== 'pending') return

    polled.current = true
    const paymentId = sessionStorage.getItem(PAYMENT_KEY)
    const gameSlug = sessionStorage.getItem(GAME_KEY) || pendingGameSlug

    const cleanUrl = () => {
      const path = window.location.pathname
      window.history.replaceState({}, '', path)
    }
    cleanUrl()

    if (!paymentId) return

    let attempts = 0
    const maxAttempts = 30

    const tick = async () => {
      attempts += 1
      try {
        const st = await pollDepositStatus(paymentId)
        if (st.status === 'completed') {
          sessionStorage.removeItem(PAYMENT_KEY)
          await fetchWallets()
          setSuccess({
            amount: st.amount,
            currency: st.currency,
            gameSlug: gameSlug ?? null,
          })
          return
        }
        if (['failed', 'expired', 'cancelled'].includes(st.status)) {
          sessionStorage.removeItem(PAYMENT_KEY)
          return
        }
      } catch {
        /* retry */
      }
      if (attempts < maxAttempts) setTimeout(tick, 2000)
    }

    tick()
  }, [fetchWallets, pendingGameSlug])

  if (!success) return null

  const returnToGame = () => {
    setSuccess(null)
    sessionStorage.removeItem(GAME_KEY)
    if (success.gameSlug) {
      router.push(`/casino/${success.gameSlug}?launch=1`)
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={() => setSuccess(null)} />
      <div className="sheet-panel">
        <p className="text-lg font-semibold text-[#00C853]">
          +{formatAmount(success.amount, success.currency)} зачислены
        </p>
        {success.gameSlug ? (
          <button type="button" className="btn-money mt-4 w-full" onClick={returnToGame}>
            Вернуться в игру
          </button>
        ) : (
          <button type="button" className="btn mt-4 w-full" onClick={() => setSuccess(null)}>
            Закрыть
          </button>
        )}
      </div>
    </>
  )
}
