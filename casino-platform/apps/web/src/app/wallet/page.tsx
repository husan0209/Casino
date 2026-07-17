'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import Link from 'next/link'

export default function WalletPage(){
  const { user } = useAuth()
  const { data: balances } = useQuery({
    queryKey: ['wallet','balances'],
    queryFn: () => apiGet<any[]>('/wallet/balances'),
    enabled: !!user, refetchInterval: 10000,
  })
  const { data: tx } = useQuery({
    queryKey: ['wallet','tx'],
    queryFn: () => apiGet<any>('/wallet/transactions?per_page=20'),
    enabled: !!user,
  })
  if (!user) return <div className="container-1 py-8">Войдите в аккаунт</div>
  return (
    <div className="container-1 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Кошелёк</h1>
        <div className="flex gap-2">
          <Link href="/deposit" className="btn text-sm">Пополнить</Link>
          <Link href="/withdraw" className="btn-ghost text-sm">Вывести</Link>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        {(balances||[]).map((b:any)=>(
          <div key={b.currency} className="card">
            <div className="text-muted text-sm">{b.currency}</div>
            <div className="text-2xl font-bold">{Number(b.available).toFixed(b.currency==='RUB'?2:8)}</div>
            <div className="text-xs text-muted">Заблокировано: {Number(b.locked).toFixed(2)}</div>
          </div>
        ))}
        {(!balances || balances.length===0) && <div className="text-muted">Нет активных балансов</div>}
      </div>
      <h2 className="font-semibold mb-3">История транзакций</h2>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Дата</th><th>Тип</th><th>Сумма</th><th>Баланс после</th><th>Описание</th></tr></thead>
          <tbody>
            {(tx?.data || []).map((t:any)=>(
              <tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString('ru')}</td>
                <td><span className="badge">{t.type}</span></td>
                <td className={parseFloat(t.amount) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t.amount} {t.currency}</td>
                <td>{t.balance_after}</td>
                <td className="text-muted">{t.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!tx?.data || tx.data.length===0) && <div className="text-muted py-6 text-center">Транзакций нет</div>}
      </div>
    </div>
  )
}
