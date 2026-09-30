'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'

import { ErrorBanner } from '@/components/ui/error-banner'
import { Field } from '@/components/ui/field'
import { toast } from '@/components/ui/toaster'
import { apiGet, apiPost, errText } from '@/lib/api'
import {
  ticketCategoryLabel,
  ticketStatusClass,
  ticketStatusLabel,
} from '@/lib/ui/support-labels'
import { useAuth } from '@/stores/auth'
import type { SupportTicketDto } from '@/types/support'

export default function SupportPage(): React.JSX.Element {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('technical')
  const [message, setMessage] = useState('')
  const { data, isError, refetch } = useQuery({
    queryKey: ['support-tickets'],
    queryFn: () => apiGet<SupportTicketDto[] | { data: SupportTicketDto[] }>('/support/tickets'),
    enabled: Boolean(user),
  })
  const createMut = useMutation({
    mutationFn: () => apiPost<unknown>('/support/tickets', { subject, category, message }),
    onSuccess: () => {
      toast.success('Тикет создан')
      setSubject('')
      setMessage('')
      void qc.invalidateQueries({ queryKey: ['support-tickets'] })
    },
    onError: (e: unknown) =>
      toast.error(errText(e) || 'Ошибка'),
  })
  if (!user) {
    return <div className="container-1 py-6">Войдите, чтобы создать обращение</div>
  }
  const tickets: SupportTicketDto[] = Array.isArray(data) ? data : (data?.data ?? [])
  return (
    <div className="container-1 py-6 max-w-3xl">
      <p className="caps-label">ПОМОЩЬ</p>
      <h1 className="page-title mb-6">Поддержка</h1>
      <div className="card mb-6">
        <div className="mb-3 font-semibold">Новый тикет</div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createMut.mutate()
          }}
          className="space-y-3"
        >
          <Field label="Тема">
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </Field>
          <Field label="Категория">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="payments">Платежи</option>
              <option value="games">Игры</option>
              <option value="technical">Техническое</option>
              <option value="account">Аккаунт</option>
              <option value="other">Другое</option>
            </select>
          </Field>
          <Field label="Сообщение">
            <textarea
              className="input min-h-[100px]"
              placeholder="Что случилось и что вы ожидали увидеть?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
            />
          </Field>
          <button disabled={createMut.isPending} className="btn">
            Создать тикет
          </button>
        </form>
      </div>
      <div className="card">
        <div className="mb-3 font-semibold">Мои тикеты</div>
        {isError && (
          <ErrorBanner text="Не удалось загрузить тикеты" onRetry={() => void refetch()} />
        )}
        <div className="space-y-2">
          {tickets.map((t) => (
            <Link
              key={t.id}
              href={`/support/${t.id}`}
              className="block rounded-xl bg-surface2 px-3 py-2.5 hover:bg-white/5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{t.subject}</span>
                <span className={`badge ${ticketStatusClass(t.status)}`}>
                  {ticketStatusLabel(t.status)}
                </span>
              </div>
              <div className="mt-1 truncate text-xs text-muted">
                #{t.id.slice(0, 8)} • {ticketCategoryLabel(t.category)} •{' '}
                {new Date(t.updatedAt || t.createdAt).toLocaleString('ru', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </div>
            </Link>
          ))}
          {tickets.length === 0 && !isError && <div className="text-sm text-muted">Тикетов нет</div>}
        </div>
      </div>
    </div>
  )
}
