'use client'
import { useState } from 'react'
import { apiPost } from '@/lib/api'
import { toast } from '@/components/ui/toaster'
export default function ForgotPage(){
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    await apiPost('/auth/forgot-password', { email })
    setSent(true); toast.success('Если email существует — письмо отправлено')
  }
  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-4">Сброс пароля</h1>
        {sent ? <p className="text-muted text-sm">Проверьте почту.</p> : (
          <form onSubmit={submit} className="space-y-3">
            <input className="input" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
            <button className="btn w-full">Отправить ссылку</button>
          </form>
        )}
      </div>
    </div>
  )
}
