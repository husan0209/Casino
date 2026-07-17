'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import Link from 'next/link'
export default function HistoryPage(){
  const { user } = useAuth()
  const { data } = useQuery({ queryKey:['casino-history'], queryFn:()=>apiGet<any>('/casino/history?per_page=50'), enabled:!!user })
  if (!user) return <div className="container-1 py-8">Войдите в аккаунт</div>
  const rows = data?.data || []
  return (
    <div className="container-1 py-8">
      <h1 className="text-2xl font-bold mb-4">История игр</h1>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Дата</th><th>Игра</th><th>Ставка</th><th>Выигрыш</th><th>Профит</th><th>Статус</th></tr></thead>
          <tbody>
            {rows.map((r:any)=>(
              <tr key={r.round_id}>
                <td>{new Date(r.created_at).toLocaleString('ru')}</td>
                <td><Link href={`/casino/${r.game.slug}`} className="hover:text-brand">{r.game.name}</Link></td>
                <td>{r.total_bet}</td>
                <td className="text-emerald-400">{r.total_win}</td>
                <td className={parseFloat(r.profit) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{r.profit}</td>
                <td><span className="badge">{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length===0 && <div className="text-muted py-6 text-center">История пуста — сыграйте в <Link href="/casino" className="text-brand">казино</Link></div>}
      </div>
    </div>
  )
}
