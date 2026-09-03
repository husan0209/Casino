'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { apiGet, apiPost } from '@/lib/api'
import type { SupportMessageDto, SupportTicketFullDto } from '@/types/support'

export default function TicketPage() {
  const { id } = useParams() as { id: string }
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const { data } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => apiGet<SupportTicketFullDto>(`/support/tickets/${id}`),
  })
  const sendMut = useMutation({
    mutationFn: () => apiPost<unknown>(`/support/tickets/${id}/messages`, { message: msg }),
    onSuccess: () => {
      setMsg('')
      void qc.invalidateQueries({ queryKey: ['ticket', id] })
      toast.success('Отправлено')
    },
  })
  const closeMut = useMutation({
    mutationFn: () => apiPost<unknown>(`/support/tickets/${id}/close`, {}),
    onSuccess: () => {
      toast.success('Тикет закрыт')
      void qc.invalidateQueries({ queryKey: ['ticket', id] })
    },
  })
  if (!data) {
    return <div className="container-1 py-8">Загрузка…</div>
  }
  const messages: SupportMessageDto[] = data.messages ?? []
  return (
    <div className="container-1 py-8 max-w-2xl">
      <h1 className="text-xl font-bold mb-2">
        #{data.id.slice(0, 8)} {data.subject}
      </h1>
      <div className="text-sm text-muted mb-4">
        {data.category} • {data.status}
        {data.status !== 'closed' && (
          <button onClick={() => closeMut.mutate()} className="ml-4 text-xs underline">
            Закрыть тикет
          </button>
        )}
      </div>
      <div className="card space-y-3 mb-4 max-h-[50vh] overflow-auto">
        {messages.map((m: SupportMessageDto) => (
          <div
            key={m.id}
            className={m.senderType === 'admin' ? 'bg-white/5 rounded-xl px-3 py-2' : ''}
          >
            <div className="text-xs text-muted">
              {m.senderType} • {new Date(m.createdAt).toLocaleString('ru')}
            </div>
            <div className="text-sm whitespace-pre-wrap">{m.message}</div>
          </div>
        ))}
      </div>
      {data.status !== 'closed' ? (
        <div className="card">
          <textarea
            className="input min-h-[80px] mb-2"
            placeholder="Ваш ответ…"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
          />
          <button
            disabled={!msg || sendMut.isPending}
            onClick={() => sendMut.mutate()}
            className="btn"
          >
            Отправить
          </button>
        </div>
      ) : (
        <div className="text-muted">Тикет закрыт</div>
      )}
    </div>
  )
}
