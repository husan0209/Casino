'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from '@/components/ui/toaster'

export default function SupportPage(){
  const { user } = useAuth()
  const qc = useQueryClient()
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('technical')
  const [message, setMessage] = useState('')
  const { data } = useQuery({
    queryKey:['support-tickets'],
    queryFn:()=> apiGet<any>('/support/tickets'),
    enabled: !!user,
  })
  const createMut = useMutation({
    mutationFn: () => apiPost('/support/tickets', { subject, category, message }),
    onSuccess: () => { toast.success('Тикет создан'); setSubject(''); setMessage(''); qc.invalidateQueries({ queryKey:['support-tickets'] })},
    onError: (e:any)=> toast.error(e?.response?.data?.error?.message || 'Ошибка')
  })
  if (!user) return <div className="container-1 py-8">Войдите, чтобы создать обращение</div>
  const tickets = data?.data || data || []
  return (
    <div className="container-1 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Поддержка</h1>
      <div className="card mb-6">
        <div className="font-semibold mb-3">Новый тикет</div>
        <form onSubmit={e=>{e.preventDefault(); createMut.mutate()}} className="space-y-3">
          <input className="input" placeholder="Тема" value={subject} onChange={e=>setSubject(e.target.value)} required />
          <select className="input" value={category} onChange={e=>setCategory(e.target.value)}>
            <option value="payments">Платежи</option>
            <option value="games">Игры</option>
            <option value="technical">Техническое</option>
            <option value="account">Аккаунт</option>
            <option value="other">Другое</option>
          </select>
          <textarea className="input min-h-[100px]" placeholder="Опишите проблему…" value={message} onChange={e=>setMessage(e.target.value)} required />
          <button disabled={createMut.isPending} className="btn">Создать тикет</button>
        </form>
      </div>
      <div className="card">
        <div className="font-semibold mb-3">Мои тикеты</div>
        <div className="space-y-2">
          {(Array.isArray(tickets)?tickets:[]).map((t:any)=>(
            <Link key={t.id} href={`/support/${t.id}`} className="block px-3 py-2 rounded-xl bg-surface2 hover:bg-white/5">
              <div className="flex justify-between"><b>#{t.id.slice(0,8)} {t.subject}</b><span className="badge">{t.status}</span></div>
              <div className="text-xs text-muted">{t.category} • {new Date(t.updated_at || t.created_at).toLocaleString('ru')}</div>
            </Link>
          ))}
          {tickets.length===0 && <div className="text-muted text-sm">Тикетов нет</div>}
        </div>
      </div>
    </div>
  )
}
