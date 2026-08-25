'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Loading, PageTitle, Pager, Select, Td, Th } from '@/components/ui'
import { apiGetFull } from '@/lib/api'

interface PaymentRow { id: string; createdAt: string; type: string; status: string; provider: string; amount: string; currency: string; externalId: string | null; user?: { email: string | null } }

export default function PaymentsPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [provider, setProvider] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['payments', page, status, type, provider],
    queryFn: () => apiGetFull<PaymentRow[]>('/admin/payment-requests', { page, per_page: 30, status: status || undefined, type: type || undefined, provider: provider || undefined }),
    refetchInterval: 15000,
  })

  return (
    <div>
      <PageTitle>Платёжные запросы</PageTitle>
      <div className="flex gap-3 mb-4">
        <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }} className="w-36">
          <option value="">Тип: все</option><option value="deposit">deposit</option><option value="withdrawal">withdrawal</option>
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-40">
          <option value="">Статус: все</option>
          {['pending','processing','completed','failed','cancelled','expired'].map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1) }} className="w-40">
          <option value="">Провайдер: все</option>
          {['rukassa','nowpayments','manual'].map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
      </div>

      {isLoading && <Loading />}
      {data?.data && (
        <>
          <table className="w-full text-sm">
            <thead><tr><Th>Дата</Th><Th>Пользователь</Th><Th>Тип</Th><Th>Провайдер</Th><Th>Сумма</Th><Th>Статус</Th><Th>External ID</Th></tr></thead>
            <tbody>
              {data.data.map((p) => (
                <tr key={p.id}>
                  <Td className="text-[#8b8ba7] whitespace-nowrap">{new Date(p.createdAt).toLocaleString('ru-RU')}</Td>
                  <Td>{p.user?.email ?? '—'}</Td>
                  <Td>{p.type}</Td>
                  <Td className="text-[#8b8ba7]">{p.provider}</Td>
                  <Td className="font-mono">{Number(p.amount).toLocaleString('ru-RU')} {p.currency}</Td>
                  <Td><Badge value={p.status} /></Td>
                  <Td className="text-[#8b8ba7] font-mono text-xs max-w-[140px] truncate">{p.externalId ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} perPage={30} total={data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  )
}
