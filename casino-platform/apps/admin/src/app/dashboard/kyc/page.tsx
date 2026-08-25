'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Btn, ErrorBox, Loading, PageTitle, Pager, Td, Th } from '@/components/ui'
import { apiGetFull, apiPost, errText } from '@/lib/api'

interface KycRow { id: string; status: string; firstName: string | null; lastName: string | null; country: string | null; documentType: string | null; submittedAt: string | null; user?: { email: string | null } }

export default function KycPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('pending')
  const [err, setErr] = useState<string>()
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [mode, setMode] = useState<'reject' | 'request-resubmission'>('request-resubmission')
  const [reason, setReason] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['kyc', page, status],
    queryFn: () => apiGetFull<KycRow[]>('/admin/kyc', { page, per_page: 20, status: status || undefined }),
    refetchInterval: 20000,
  })

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'request-resubmission' }) =>
      apiPost(`/admin/kyc/${id}/${action}`, action === 'approve' ? {} : { reason }),
    onSuccess: () => { setErr(undefined); setRejectId(null); setReason(''); qc.invalidateQueries({ queryKey: ['kyc'] }) },
    onError: (e) => setErr(errText(e)),
  })

  return (
    <div>
      <PageTitle>KYC заявки</PageTitle>
      <ErrorBox msg={err} />
      <div className="flex gap-2 mb-4 text-sm">
        {([['', 'Все'], ['pending', 'Ожидают'], ['approved', 'Одобрены'], ['rejected', 'Отклонены'], ['requires_resubmission', 'Повторная отправка']] as Array<[string, string]>).map(([v, l]) => (
          <button key={v} onClick={() => { setStatus(v); setPage(1) }}
            className={`rounded-lg px-3 py-1.5 ${status === v ? 'bg-[#ff3b7a]' : 'bg-white/5 hover:bg-white/10'}`}>{l}</button>
        ))}
      </div>

      {isLoading && <Loading />}
      {data?.data && (
        <>
          <table className="w-full text-sm">
            <thead><tr><Th>Пользователь</Th><Th>Имя</Th><Th>Страна</Th><Th>Документ</Th><Th>Подана</Th><Th>Статус</Th><Th>Действия</Th></tr></thead>
            <tbody>
              {data.data.map((k) => (
                <tr key={k.id}>
                  <Td>{k.user?.email ?? '—'}</Td>
                  <Td>{[k.firstName, k.lastName].filter(Boolean).join(' ') || '—'}</Td>
                  <Td className="text-[#8b8ba7]">{k.country ?? '—'}</Td>
                  <Td className="text-[#8b8ba7]">{k.documentType ?? '—'}</Td>
                  <Td className="text-[#8b8ba7]">{k.submittedAt ? new Date(k.submittedAt).toLocaleString('ru-RU') : '—'}</Td>
                  <Td><Badge value={k.status} /></Td>
                  <Td>
                    {(k.status === 'pending' || k.status === 'requires_resubmission') && (
                      rejectId === k.id ? (
                        <div className="flex gap-1 items-center">
                          <input className="input text-xs w-40" placeholder="Причина" value={reason} onChange={e => setReason(e.target.value ?? '')} />
                          <Btn small variant="danger" onClick={() => act.mutate({ id: k.id, action: mode })}>OK</Btn>
                          <Btn small variant="ghost" onClick={() => setRejectId(null)}>✕</Btn>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <Btn small variant="ok" onClick={() => act.mutate({ id: k.id, action: 'approve' })}>Одобрить</Btn>
                          <Btn small variant="danger" onClick={() => { setRejectId(k.id); setMode('reject'); setReason('') }}>Отклонить</Btn>
                          <Btn small variant="ghost" onClick={() => { setRejectId(k.id); setMode('request-resubmission'); setReason('') }}>Повторно</Btn>
                        </div>
                      )
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} perPage={20} total={data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  )
}
