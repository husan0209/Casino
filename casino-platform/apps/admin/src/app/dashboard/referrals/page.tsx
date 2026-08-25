'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Card, Loading, PageTitle, Pager, Td, Th } from '@/components/ui'
import { apiGet, apiGetFull } from '@/lib/api'

interface Stats { total_referrals: number; total_rewards_paid: string; top_referrers: Array<{ user_id: string; email: string | null; referral_count: number; total_earned: string }> }

export default function ReferralsPage() {
  const [page, setPage] = useState(1)
  const stats = useQuery({ queryKey: ['ref-stats'], queryFn: () => apiGet<Stats>('/admin/referrals/stats') })
  const list = useQuery({ queryKey: ['ref-list', page], queryFn: () => apiGetFull<any[]>('/admin/referrals', { page, per_page: 20 }) })

  return (
    <div>
      <PageTitle>Реферальная система</PageTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <div className="text-sm text-[#8b8ba7]">Всего привлечено пользователей</div>
          <div className="text-2xl font-bold mt-1">{stats.data?.total_referrals ?? '…'}</div>
        </Card>
        <Card>
          <div className="text-sm text-[#8b8ba7]">Выплачено вознаграждений (RUB экв.)</div>
          <div className="text-2xl font-bold mt-1">{stats.data ? `${Number(stats.data.total_rewards_paid).toLocaleString('ru-RU')} ₽` : '…'}</div>
        </Card>
      </div>

      <h2 className="font-semibold mb-3">Топ рефереров</h2>
      <Card className="mb-6">
        {stats.isLoading && <Loading />}
        <table className="w-full text-sm">
          <thead><tr><Th>Email</Th><Th>Рефералов</Th><Th>Заработано</Th></tr></thead>
          <tbody>
            {(stats.data?.top_referrers ?? []).map(r => (
              <tr key={r.user_id}>
                <Td>{r.email ?? r.user_id.slice(0, 8)}</Td>
                <Td className="font-mono">{r.referral_count}</Td>
                <Td className="font-mono">{Number(r.total_earned).toLocaleString('ru-RU')}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <h2 className="font-semibold mb-3">Начисления</h2>
      {list.isLoading && <Loading />}
      {list.data?.data && (
        <>
          <table className="w-full text-sm">
            <thead><tr><Th>Реферер</Th><Th>Реферал</Th><Th>GGR</Th><Th>Ставка</Th><Th>Сумма</Th><Th>Статус</Th></tr></thead>
            <tbody>
              {list.data.data.map((r) => (
                <tr key={r.id}>
                  <Td>{r.referrer?.email ?? '—'}</Td>
                  <Td className="text-[#8b8ba7]">{r.referred?.email ?? '—'}</Td>
                  <Td className="font-mono">{Number(r.ggrAmount).toLocaleString('ru-RU')}</Td>
                  <Td className="font-mono text-[#8b8ba7]">{(Number(r.rewardRate) * 100).toFixed(1)}%</Td>
                  <Td className="font-mono">{Number(r.rewardAmount).toLocaleString('ru-RU')}</Td>
                  <Td><Badge value={r.status} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} perPage={20} total={list.data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  )
}
