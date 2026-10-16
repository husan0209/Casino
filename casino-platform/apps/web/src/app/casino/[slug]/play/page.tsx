'use client'

import { ChevronLeft } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect } from 'react'

import { isCloseRequest, leaveGame } from '@/lib/ui/game-exit'
import { useAuth } from '@/stores/auth'
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
  const { activeCurrency, refreshActive } = useWalletStore()
  const { openDeposit } = useUIStore()
  const { user } = useAuth()

  /**
   * Баланс на планке не показываем (решение владельца 2026-10-16). Свою сумму
   * игра рисует сама и берёт её у того же сервера: `originals-session.use-case.ts`
   * отдаёт в клиент `credit = balance.available`. Вторая цифра рядом с ней —
   * это либо противоречие в демо (0 ₽ рядом со 1 000 ₽ виртуальных), либо
   * отставание в деньги: без WebSocket (§2.1) шапка узнала бы о ставке только
   * по возврату фокуса. Refetch остаётся при выходе — чтобы лобби показывало
   * свежий кошелёк.
   */

  /**
   * Выход из игры. Это единственная дверь наружу для клиентов, которые свою
   * кнопку не рисуют — все одиннадцать донорских слотов и Plinko, — поэтому
   * она обязана быть крупной: прежняя «×» была 13×28 px при норме 44×44 для
   * пальца, и на телефоне в неё промахивались.
   */
  const exitGame = useCallback((): void => {
    void refreshActive()
    leaveGame({
      referrer: document.referrer,
      origin: window.location.origin,
      historyLength: window.history.length,
      back: () => window.history.back(),
      home: () => router.push('/'),
    })
  }, [refreshActive, router])

  /**
   * Просьба фрейма закрыться (`PROVIDER_INTEGRATION_STRATEGY.md` §6.1, шаг 3
   * «Listen for events from iframe») — без неё внутренняя кнопка игры стучится
   * в пустоту. Источник проверяется: иначе любой фрейм командовал бы навигацией.
   */
  useEffect((): (() => void) => {
    const onMessage = (event: MessageEvent): void => {
      if (isCloseRequest(event, window.location.origin)) {
        exitGame()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [exitGame])

  if (!url) {
    return <div className="container-1 py-8 text-muted">Игра не найдена</div>
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0F0F1A] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#2A2A4A] px-3">
        <button
          type="button"
          onClick={exitGame}
          aria-label="Выйти из игры"
          className="-ml-2 flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-sm font-medium text-white/90 active:bg-white/10"
        >
          <ChevronLeft size={20} aria-hidden />
          Выйти
        </button>
        {user && (
          <button
            type="button"
            aria-label="Пополнить баланс"
            className="btn-money flex min-h-[44px] min-w-[44px] items-center justify-center px-3 text-sm"
            onClick={() => openDeposit(activeCurrency)}
          >
            +
          </button>
        )}
      </div>
      {/* decodeURIComponent: url приезжает закодированным из launch-flow */}
      <GameFrame url={decodeURIComponent(url)} />
    </div>
  )
}
