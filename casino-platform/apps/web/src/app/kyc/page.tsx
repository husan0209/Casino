'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useState } from 'react'
import { toast } from '@/components/ui/toaster'

export default function KycPage(){
  const { user } = useAuth()
  const { data, refetch } = useQuery({
    queryKey: ['kyc-status'],
    queryFn: () => apiGet<any>('/kyc/status'),
    enabled: !!user,
  })
  const [form, setForm] = useState<any>({ first_name:'', last_name:'', date_of_birth:'', country:'RU', document_type:'passport', document_number:'', document_expiry:'' })
  const [files, setFiles] = useState<Record<string, File|null>>({ front:null, back:null, selfie:null })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await apiPost('/kyc/submit', form); toast.success('KYC заявка подана'); refetch() }
    catch(err:any){ toast.error(err?.response?.data?.error?.message || 'Ошибка') }
  }
  const uploadDoc = async (type: string) => {
    const file = files[type]; if (!file) return
    const fd = new FormData(); fd.append('file', file); fd.append('document_type', type)
    try {
      await fetch((process.env.NEXT_PUBLIC_API_URL||'http://localhost:3001/api/v1') + '/kyc/documents', {
        method: 'POST', body: fd, credentials: 'include'
      })
      toast.success('Документ загружен'); refetch()
    } catch { toast.error('Ошибка загрузки') }
  }

  if (!user) return <div className="container-1 py-8">Войдите в аккаунт</div>
  const status = data?.status || 'not_started'

  return (
    <div className="container-1 py-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">KYC Верификация</h1>
      <div className="text-sm text-muted mb-6">Лимит без KYC: 5000 ₽ суммарных пополнений. Вывод всегда требует KYC.</div>
      <div className="card mb-6">
        Статус: <b className={
          status==='approved'?'text-emerald-400':status==='pending'?'text-amber-400':status==='rejected'?'text-red-400':'text-muted'
        }>{status}</b>
        {data?.rejection_reason && <div className="text-red-400 text-sm mt-2">Причина: {data.rejection_reason}</div>}
        {data?.documents?.length > 0 && <div className="text-xs text-muted mt-2">Загружено документов: {data.documents.join(', ')}</div>}
      </div>

      {(status==='not_started' || status==='requires_resubmission' || status==='rejected') && (
        <form onSubmit={submit} className="card space-y-3 mb-6">
          <div className="font-semibold">Персональные данные</div>
          <div className="grid md:grid-cols-2 gap-3">
            <input className="input" placeholder="Имя" required onChange={e=>setForm((f:any)=>({...f, first_name:e.target.value}))} />
            <input className="input" placeholder="Фамилия" required onChange={e=>setForm((f:any)=>({...f, last_name:e.target.value}))} />
            <input className="input" type="date" required onChange={e=>setForm((f:any)=>({...f, date_of_birth:e.target.value}))} />
            <input className="input" placeholder="Страна (RU)" defaultValue="RU" onChange={e=>setForm((f:any)=>({...f, country:e.target.value}))} />
            <select className="input" onChange={e=>setForm((f:any)=>({...f, document_type:e.target.value}))}>
              <option value="passport">Паспорт</option>
              <option value="id_card">ID карта</option>
              <option value="drivers_license">Водительское</option>
            </select>
            <input className="input" placeholder="Номер документа" required onChange={e=>setForm((f:any)=>({...f, document_number:e.target.value}))} />
            <input className="input" type="date" placeholder="Срок действия" onChange={e=>setForm((f:any)=>({...f, document_expiry:e.target.value}))} />
          </div>
          <button className="btn">Подать заявку KYC</button>
        </form>
      )}

      {(status==='pending' || status==='requires_resubmission') && (
        <div className="card space-y-3">
          <div className="font-semibold">Загрузка документов</div>
          {(['front','back','selfie'] as const).map(t => (
            <div key={t} className="flex gap-2 items-center">
              <input type="file" accept="image/*,.pdf" className="text-sm" onChange={e=>setFiles(f=>({...f, [t]: e.target.files?.[0] || null}))} />
              <span className="text-sm text-muted w-32">{t==='front'?'Лицевая':t==='back'?'Обратная':'Селфи'}</span>
              <button onClick={()=>uploadDoc(t)} className="btn-ghost text-xs px-3 py-1.5">Загрузить</button>
            </div>
          ))}
          <div className="text-xs text-muted">JPG / PNG / PDF, до 10 MB</div>
        </div>
      )}
      {status==='approved' && <div className="card text-emerald-400">✅ Верификация пройдена. Пополнения и выводы доступны без ограничений.</div>}
    </div>
  )
}
