'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Btn, ErrorBox, Input } from '@/components/ui'
import { errText } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

export default function LoginPage() {
  const router = useRouter()
  const login = useAuthStore((s) => s.login)
  const token = useAuthStore((s) => s.token)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string>()
  const [busy, setBusy] = useState(false)

  if (token) {
    router.replace('/dashboard')
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(undefined)
    setBusy(true)
    try {
      await login(email.trim(), password)
      router.replace('/dashboard')
    } catch (e2) {
      setErr(errText(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0b12]">
      <form onSubmit={submit} className="w-full max-w-sm bg-[#141420] border border-white/10 rounded-2xl p-6">
        <h1 className="text-xl font-bold mb-1">Admin Panel</h1>
        <p className="text-sm text-[#8b8ba7] mb-4">Вход для администраторов</p>
        <ErrorBox msg={err} />
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mb-3 w-full" />
        <Input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} required className="mb-4 w-full" />
        <Btn disabled={busy}>{busy ? 'Вход…' : 'Войти'}</Btn>
      </form>
    </div>
  )
}
