'use client'
import { useQuery } from '@tanstack/react-query'

import { apiGet } from '@/lib/api'
import { currencyLabel } from '@/lib/format/currency'
import { useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'
import type { WalletBalance } from '@/types/wallet'
import type { WalletTxListDto } from '@/types/wallet-tx'

import { type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

export default function WalletPage(): React.JSX.Element {
  const { user } = useAuth()
  const { activeCurrency, setActiveCurrency } = useWalletStore()
  const { openDeposit, openWithdraw } = useUIStore()
  const { data: balances } = useQuery({
    queryKey: ['wallet', 'balances'],
    queryFn: () => apiGet<WalletBalance[]>('/wallet/balances'),
    enabled: Boolean(user),
    refetchInterval: 10000,
  })
  const { data: tx } = useQuery({
    queryKey: ['wallet', 'tx'],
    queryFn: () => apiGet<WalletTxListDto>('/wallet/transactions?per_page=20'),
    enabled: Boolean(user),
  })
  if (!user) {
    return <div className="container-1 py-8">Войдите в аккаунт</div>
  }
  return (
    <div className="container-1 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Кошелёк</h1>
        <div className="flex gap-2">
          {/* GAP-55 (§2.9/§10): касса живёт в глобальных sheets, не на отдельных страницах */}
          <button type="button" className="btn text-sm" onClick={() => openDeposit(activeCurrency)}>
            Пополнить
          </button>
          <button type="button" className="btn-ghost text-sm" onClick={() => openWithdraw(activeCurrency)}>
            Вывести
          </button>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        {(balances ?? []).map((b) => (
          <div key={b.currency} className="card">
            <div className="text-muted text-sm">{currencyLabel(b.currency)}</div>
            <div className="text-2xl font-bold">{money.toDisplay(b.available, b.currency as Currency)}</div>
            <div className="text-xs text-muted">
              Заблокировано: {money.toDisplay(b.locked, b.currency as Currency)}
            </div>
            {/* §10.1: ненулевой — сделать активным; нулевой — активировать и открыть кассу этой валюты */}
            {money.isPositive(b.available) ? (
              <button
                type="button"
                className="btn-ghost mt-3 w-full text-xs"
                onClick={() => {
                  void setActiveCurrency(b.currency)
                }}
              >
                {b.currency === activeCurrency ? 'Активен' : 'Открыть'}
              </button>
            ) : (
              <button
                type="button"
                className="btn-money mt-3 w-full text-xs"
                onClick={() => openDeposit(b.currency)}
              >
                Пополнить
              </button>
            )}
          </div>
        ))}
        {(!balances || balances.length === 0) && (
          <div className="text-muted">Нет активных балансов</div>
        )}
      </div>
      <h2 className="font-semibold mb-3">История транзакций</h2>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Тип</th>
              <th>Сумма</th>
              <th>Баланс после</th>
              <th>Описание</th>
            </tr>
          </thead>
          <tbody>
            {(tx?.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString('ru')}</td>
                <td>
                  <span className="badge">{t.type}</span>
                </td>
                <td
                  className={
                    money.isGreaterOrEqual(t.amount, '0') ? 'text-emerald-400' : 'text-red-400'
                  }
                >
                  {t.amount} {t.currency}
                </td>
                <td>{t.balance_after}</td>
                <td className="text-muted">{t.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!tx?.data || tx.data.length === 0) && (
          <div className="text-muted py-6 text-center">Транзакций нет</div>
        )}
      </div>
    </div>
  )
}
