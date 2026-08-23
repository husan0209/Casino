'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGetFull, apiPost, errText } from '@/lib/api'
import { Badge, Btn, ErrorBox, Loading, PageTitle, Pager, Select, Td, Th } from '@/components/ui'

interface TicketRow { id: string; subject: string; category: string; status: string; priority: string; createdAt: string; user?: { email: string | null } }

export default function SupportPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('open')
  const [err, setErr] = useState<string>()
  const [openId, setOpenId] = useState<string | null>(null)
  const [reply, setReply] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', page, status],
    queryFn: () => apiGetFull<TicketRow[]>('/admin/support/tickets', { page, per_page: 20, status: status || undefined }),
    refetchInterval: 20000,
  })

  const messages = useQuery({
    queryKey: ['ticket', openId],
    queryFn: () => apiGetFull<any>(`/admin/support/tickets/${openId}`),
    enabled: !!openId,
  })

  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: unknown }) =>
      action === 'messages' ? apiPost(`/admin/support/tickets/${id}/messages`, body) : apiPost(`/admin/support/tickets/${id}/${action}`, body),
    onSuccess: () => {
      setErr(undefined); setReply('')
      qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['ticket'] })
    },
    onError: (e) => setErr(errText(e)),
  })

  return (
    <div>
      <PageTitle>Поддержка</PageTitle>
      <ErrorBox msg={err} />
      <Select className="w-48 mb-4" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
        <option value="">Все статусы</option>
        {['open','in_progress','waiting_user','closed'].map(s => <option key={s} value={s}>{s}</option>)}
      </Select>

      {isLoading && <Loading />}
      {data?.data && (
        <>
          <table className="w-full text-sm">
            <thead><tr><Th>Тема</Th><Th>Пользователь</Th><Th>Категория</Th><Th>Приоритет</Th><Th>Статус</Th><Th>Создан</Th><Th></Th></tr></thead>
            <tbody>
              {data.data.map((t) => (
                <tr key={t.id}>
                  <Td>{t.subject}</Td>
                  <Td className="text-[#8b8ba7]">{t.user?.email ?? '—'}</Td>
                  <Td><Badge value={t.category} /></Td>
                  <Td>{t.priority}</Td>
                  <Td><Badge value={t.status} /></Td>
                  <Td className="text-[#8b8ba7] whitespace-nowrap">{new Date(t.createdAt).toLocaleString('ru-RU')}</Td>
                  <Td><Btn small variant="ghost" onClick={() => setOpenId(openId === t.id ? null : t.id)}>{openId === t.id ? 'Скрыть' : 'Открыть'}</Btn></Td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} perPage={20} total={data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}

      {openId && (
        <div className="mt-6 bg-[#141420] border border-white/10 rounded-2xl p-4">
          <h3 className="font-semibold mb-3">Диалог #{openId.slice(0, 8)}</h3>
          <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
            {(messages.data?.data?.messages ?? []).map((m: any) => (
              <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.senderType === 'admin' ? (m.isInternal ? 'bg-yellow-900/40' : 'bg-blue-900/30') : 'bg-white/5'}`}>
                <div className="text-xs text-[#8b8ba7] mb-0.5">
                  {m.senderType === 'admin' ? (m.isInternal ? 'Внутренняя заметка' : 'Админ') : 'Пользователь'} · {new Date(m.createdAt).toLocaleString('ru-RU')}
                </div>
                {m.message}
              </div>
            ))}
          </div>
          <textarea className="input min-h-[70px] w-full mb-2" placeholder="Ответ…" value={reply} onChange={e => setReply(e.target.value)} />
          <div className="flex gap-2 flex-wrap items-center">
            <Btn small onClick={() => act.mutate({ id: openId, action: 'messages', body: { message: reply, is_internal: false } })} disabled={!reply.trim()}>Ответить</Btn>
            <Btn small variant="ghost" onClick={() => act.mutate({ id: openId, action: 'messages', body: { message: reply, is_internal: true } })} disabled={!reply.trim()}>Внутр. заметка</Btn>
            <Btn small variant="ghost" onClick={() => act.mutate({ id: openId, action: 'assign', body: {} })}>Назначить на себя*</Btn>
            <Select className="w-32 !py-1" defaultValue="" onChange={e => e.target.value && act.mutate({ id: openId, action: 'priority', body: { priority: e.target.value } })}>
              <option value="">Приоритет…</option>
              {['low','normal','high','urgent'].map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Btn small variant="danger" onClick={() => act.mutate({ id: openId, action: 'close' })}>Закрыть тикет</Btn>
          </div>
        </div>
      )}
    </div>
  )
}
