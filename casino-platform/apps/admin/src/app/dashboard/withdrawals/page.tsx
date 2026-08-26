'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Btn, ErrorBox, Input, Loading, PageTitle, Pager, Select, Td, Th } from '@/components/ui'
import { apiGetFull, apiPost, errText } from '@/lib/api'

interface WdRow { id: string; createdAt: string; status: string; amount: string; currency: string; method: string | null; destination: any; user?: { email: string | null } }

const destText = (d: any) => typeof d?.card_masked === 'string' ? d.card_masked : typeof d?.address === 'string' ? d.address : d ? JSON.stringify(d).slice(0, 40) : '—'

export default function WithdrawalsPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('pending')
  const [err, setErr] = useState<string>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [batchReason, setBatchReason] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['withdrawals', page, status],
    queryFn: () => apiGetFull<WdRow[]>('/admin/withdrawals', { page, per_page: 30, status: status || undefined }),
    refetchInterval: 15000,
  })

  function invalidate() { void qc.invalidateQueries({ queryKey: ['withdrawals'] }); setSelected(new Set()) }

  const single = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => apiPost(`/admin/withdrawals/${id}/${action}`, action === 'reject' ? { reason } : {}),
    onSuccess: () => { setErr(undefined); setRejectId(null); setReason(''); invalidate() },
    onError: (e) => setErr(errText(e)),
  })

  const batch = useMutation({
    mutationFn: ({ action }: { action: 'batch-approve' | 'batch-reject' }) =>
      apiPost<{ approved?: number; rejected?: number; failed: Array<{ id: string }> }>(`/admin/withdrawals/${action}`,
        action === 'batch-reject' ? { ids: [...selected], reason: batchReason || 'Причина не указана' } : { ids: [...selected] }),
    onSuccess: (res) => {
      setErr(undefined); invalidate()
      const done = res.approved ?? res.rejected ?? 0
      if (res.failed.length) setErr(`Обработано: ${done}, ошибок: ${res.failed.length} (${res.failed.map(f => f.id.slice(0, 8)).join(', ')})`)
      else setErr(undefined)
      setBatchReason('')
    },
    onError: (e) => setErr(errText(e)),
  })

  const rows = data?.data ?? []
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id))

  return (
    <div>
      <PageTitle>Заявки на вывод</PageTitle>
      <ErrorBox msg={err} />

      <div className="flex gap-3 items-center mb-4 flex-wrap">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-44">
          <option value="">Все статусы</option>
          {['pending','processing','completed','cancelled','failed','expired'].map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        {selected.size > 0 && (
          <>
            <span className="text-sm text-[#8b8ba7]">Выбрано: {selected.size}</span>
            <Btn small variant="ok" disabled={batch.isPending} onClick={() => batch.mutate({ action: 'batch-approve' })}>✅ Одобрить выбранные</Btn>
            <Input small placeholder="Причина отказа…" value={batchReason} onChange={e => setBatchReason(e.target.value ?? '')} className="w-52" />
            <Btn small variant="danger" disabled={batch.isPending || !batchReason.trim()} onClick={() => batch.mutate({ action: 'batch-reject' })}>❌ Отклонить выбранные</Btn>
          </>
        )}
      </div>

      {isLoading && <Loading />}
      {data && (
        <>
          <table className="w-full text-sm">
            <thead><tr><Th><input type="checkbox" checked={allSelected} onChange={() => allSelected ? setSelected(new Set()) : setSelected(new Set(rows.map(r => r.id)))} /></Th><Th>Дата</Th><Th>Пользователь</Th><Th>Сумма</Th><Th>Метод / реквизиты</Th><Th>Статус</Th><Th>Действия</Th></tr></thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <Td><input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w.id)} disabled={w.status !== 'pending'} /></Td>
                  <Td className="text-[#8b8ba7] whitespace-nowrap">{new Date(w.createdAt).toLocaleString('ru-RU')}</Td>
                  <Td>{w.user?.email ?? '—'}</Td>
                  <Td className="font-mono whitespace-nowrap">{Number(w.amount).toLocaleString('ru-RU')} {w.currency}</Td>
                  <Td className="text-[#8b8ba7] max-w-[200px] truncate">{w.method ?? ''} · {destText(w.destination)}</Td>
                  <Td><Badge value={w.status} /></Td>
                  <Td>
                    {w.status === 'pending' && (
                      rejectId === w.id ? (
                        <div className="flex gap-1">
                          <input className="input text-xs w-32" placeholder="Причина" value={reason} onChange={e => setReason(e.target.value)} />
                          <Btn small variant="danger" onClick={() => single.mutate({ id: w.id, action: 'reject' })}>OK</Btn>
                          <Btn small variant="ghost" onClick={() => setRejectId(null)}>✕</Btn>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <Btn small variant="ok" onClick={() => single.mutate({ id: w.id, action: 'approve' })}>Одобрить</Btn>
                          <Btn small variant="danger" onClick={() => { setRejectId(w.id); setReason('') }}>Отклонить</Btn>
                        </div>
                      )
                    )}
                  </Td>
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
