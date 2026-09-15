'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { useUIStore } from '@/stores/ui'

/**
 * GAP-55 (§2.9/§10): касса пополнения живёт в глобальном DepositSheet
 * (методы по гео, пресеты, KYC-остаток, крипта с сетью), отдельная страница
 * по ТЗ не нужна. Маршрут — хост: прямая ссылка открывает лист, а не
 * вторую реализацию кассы (в ней раньше, в частности, предлагались TON/TRX/LTC,
 * запрещённые релизом §24).
 */
export default function DepositHostPage(): React.JSX.Element {
  const { depositSheet, openDeposit, closeDeposit } = useUIStore()

  useEffect(() => {
    openDeposit()
    return () => closeDeposit()
  }, [openDeposit, closeDeposit])

  return (
    <div className="container-1 max-w-lg py-8">
      {!depositSheet && (
        <div className="card space-y-3 text-center">
          <h1 className="text-xl font-bold">Пополнение</h1>
          <p className="text-sm text-muted">Лист закрыт.</p>
          <div className="flex justify-center gap-2">
            <button type="button" className="btn-money" onClick={() => openDeposit()}>
              Открыть заново
            </button>
            <Link href="/wallet" className="btn-ghost">
              В кошелёк
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
