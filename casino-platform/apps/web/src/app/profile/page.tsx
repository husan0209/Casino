'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useState } from 'react'
import { toast } from '@/components/ui/toaster'

export default function ProfilePage(){
  const { user } = useAuth()
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet<any>('/users/me'),
    enabled: !!user,
  })
  const [form, setForm] = useState<any>({})
  if (!user) return <div className="container-1 py-8">Войдите в аккаунт</div>
  const p = data?.profile || {}
  const save = async () => {
    try { await apiPost('/users/me/profile', form); toast.success('Сохранено'); refetch() }
    catch(e:any){ toast.error(e?.response?.data?.error?.message || 'Ошибка') }
  }
  return (
    <div className="container-1 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Профиль</h1>
      {isLoading ? 'Загрузка…' : (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="card space-y-3">
            <div className="text-sm text-muted">Email</div>
            <div>{data.user.email}</div>
            <div className="text-sm text-muted">KYC статус</div>
            <div><span className="badge">{data.kyc_status}</span></div>
            <div className="text-sm text-muted">Реферальный код</div>
            <div className="font-mono">{data.user.referral_code}</div>
          </div>
          <div className="card space-y-3">
            <div className="font-semibold">Личные данные</div>
            <input className="input" placeholder="Имя" defaultValue={p.first_name || ''} onChange={e=>setForm((f:any)=>({...f, first_name:e.target.value}))} />
            <input className="input" placeholder="Фамилия" defaultValue={p.last_name || ''} onChange={e=>setForm((f:any)=>({...f, last_name:e.target.value}))} />
            <input className="input" placeholder="Страна (RU)" defaultValue={p.country || ''} onChange={e=>setForm((f:any)=>({...f, country:e.target.value}))} />
            <input className="input" placeholder="Город" defaultValue={p.city || ''} onChange={e=>setForm((f:any)=>({...f, city:e.target.value}))} />
            <button onClick={save} className="btn w-full">Сохранить</button>
          </div>
        </div>
      )}
    </div>
  )
}
