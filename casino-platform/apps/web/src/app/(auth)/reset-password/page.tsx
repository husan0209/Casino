'use client'
import { useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiPost } from '@/lib/api'
import { toast } from '@/components/ui/toaster'
import { Suspense } from 'react'

function ResetInner(){
  const sp = useSearchParams()
  const token = sp.get('token') || ''
  const [pw, setPw] = useState('')
  const router = useRouter()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await apiPost('/auth/reset-password', { token, new_password: pw }); toast.success('Пароль изменён'); router.push('/login') }
    catch(err:any){ toast.error(err?.response?.data?.error?.message || 'Ошибка') }
  }
  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-4">Новый пароль</h1>
        <form onSubmit={submit} className="space-y-3">
          <input className="input" type="password" placeholder="Новый пароль" value={pw} onChange={e=>setPw(e.target.value)} required />
          <button className="btn w-full">Сохранить</button>
        </form>
      </div>
    </div>
  )
}
export default function ResetPasswordPage(){ return <Suspense><ResetInner/></Suspense> }
