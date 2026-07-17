'use client'
import { useState } from 'react'
import { useAuth } from '@/stores/auth'
import { toast } from '@/components/ui/toaster'
import Link from 'next/link'

export default function RegisterPage(){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ref, setRef] = useState('')
  const [sent, setSent] = useState(false)
  const register = useAuth(s=>s.register)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await register(email, password, ref || undefined); setSent(true); toast.success('Письмо отправлено на email') }
    catch(err:any){ toast.error(err?.response?.data?.error?.message || 'Ошибка регистрации') }
  }
  if (sent) return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card text-center">
        <h1 className="text-xl font-bold mb-2">Проверьте email</h1>
        <p className="text-muted text-sm">Мы отправили письмо с подтверждением на {email}</p>
      </div>
    </div>
  )
  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-4">Регистрация</h1>
        <form onSubmit={submit} className="space-y-3">
          <input className="input" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Пароль (мин. 8 симв.)" value={password} onChange={e=>setPassword(e.target.value)} required />
          <input className="input" placeholder="Реферальный код (необязательно)" value={ref} onChange={e=>setRef(e.target.value)} />
          <button className="btn w-full">Зарегистрироваться</button>
        </form>
        <div className="text-sm text-muted mt-3">Есть аккаунт? <Link href="/login" className="text-white">Войти</Link></div>
      </div>
    </div>
  )
}
