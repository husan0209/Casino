'use client'
import { useState } from 'react'
import { useAuth } from '@/stores/auth'
import { toast } from '@/components/ui/toaster'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function LoginPage(){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const login = useAuth(s=>s.login)
  const router = useRouter()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true)
    try { await login(email, password); toast.success('Вход выполнен'); router.push('/profile') }
    catch(err:any){ toast.error(err?.response?.data?.error?.message || 'Ошибка входа') }
    finally { setLoading(false) }
  }
  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-4">Вход</h1>
        <form onSubmit={submit} className="space-y-3">
          <input className="input" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Пароль" value={password} onChange={e=>setPassword(e.target.value)} required />
          <button className="btn w-full" disabled={loading}>{loading ? '...' : 'Войти'}</button>
        </form>
        <div className="text-sm text-muted mt-3 flex justify-between">
          <Link href="/register" className="hover:text-white">Регистрация</Link>
          <Link href="/forgot-password" className="hover:text-white">Забыли пароль?</Link>
        </div>
        <div className="text-xs text-muted mt-4">Google / Telegram OAuth — подключается при наличии ключей (Часть 2)</div>
      </div>
    </div>
  )
}
