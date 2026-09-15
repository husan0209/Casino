'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { useUIStore } from '@/stores/ui'

/**
 * GAP-55 (§2.9/§10.3): вывод живёт в глобальном WithdrawSheet, отдельной
 * страницы по ТЗ не нужно. Маршрут оставлен как хост: прямая ссылка/закладка
 * открывает лист, а не 404 и не дублирующую форму (старая страница к тому же
 * ломалась: слала destination объектом, а API ждёт строку → 422).
 */
export default function WithdrawHostPage(): React.JSX.Element {
  const { withdrawSheet, openWithdraw, closeWithdraw } = useUIStore()

  useEffect(() => {
    openWithdraw()
    return () => closeWithdraw()
  }, [openWithdraw, closeWithdraw])

  return (
    <div className="container-1 max-w-lg py-8">
      {!withdrawSheet && (
        <div className="card space-y-3 text-center">
          <h1 className="text-xl font-bold">Вывод средств</h1>
          <p className="text-sm text-muted">Лист закрыт.</p>
          <div className="flex justify-center gap-2">
            <button type="button" className="btn" onClick={() => openWithdraw()}>
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
