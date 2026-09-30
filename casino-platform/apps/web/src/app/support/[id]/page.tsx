'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { apiGet, apiPost } from '@/lib/api'
import {
  senderLabel,
  ticketCategoryLabel,
  ticketStatusClass,
  ticketStatusLabel,
} from '@/lib/ui/support-labels'
import type { SupportMessageDto, SupportTicketFullDto } from '@/types/support'

export default function TicketPage(): React.JSX.Element {
  const { id } = useParams() as { id: string }
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const { data, isPending, isError } = useQuery({
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
  if (isPending) {
    return <div className="container-1 py-6">Загрузка…</div>
  }
  // Иначе любая опечатка в ссылке на обращение («/support/new», чужой id)
  // оставляет пользователя на вечно вращающейся «Загрузка…».
  if (isError) {
    return (
      <div className="container-1 py-6">
        <p className="caps-label">ОБРАЩЕНИЕ</p>
        <h1 className="page-title mb-2">Обращение не найдено</h1>
        <p className="mb-5 text-sm text-muted">Тикет удалён или был создан в другом аккаунте.</p>
        <Link href="/support" className="btn-ghost">
          Ко всем обращениям
        </Link>
      </div>
    )
  }
  const messages: SupportMessageDto[] = data.messages
  return (
    <div className="container-1 py-6 max-w-2xl">
      <p className="caps-label">ОБРАЩЕНИЕ</p>
      <h1 className="page-title mb-3">{data.subject}</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className={`badge ${ticketStatusClass(data.status)}`}>
          {ticketStatusLabel(data.status)}
        </span>
        <span>#{data.id.slice(0, 8)}</span>
        <span>• {ticketCategoryLabel(data.category)}</span>
        {data.status !== 'closed' && (
          <button
            onClick={() => closeMut.mutate()}
            className="btn-ghost ml-auto px-3 py-1 text-xs"
          >
            Закрыть тикет
          </button>
        )}
      </div>
      <div className="card mb-4 max-h-[50vh] space-y-3 overflow-auto">
        {messages.map((m: SupportMessageDto) => (
          <div
            key={m.id}
            className={m.senderType === 'admin' ? 'rounded-xl bg-white/5 p-3' : ''}
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-muted">
              <b className={m.senderType === 'admin' ? 'text-brand-light' : undefined}>
                {senderLabel(m.senderType)}
              </b>
              <span>
                {new Date(m.createdAt).toLocaleString('ru', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </div>
            <div className="whitespace-pre-wrap text-sm">{m.message}</div>
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
