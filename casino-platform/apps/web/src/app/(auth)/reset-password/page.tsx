'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useState, Suspense } from 'react'

import { toast } from '@/components/ui/toaster'
import { apiPost, errText } from '@/lib/api'

function ResetInner(): React.JSX.Element {
  const sp = useSearchParams()
  const token = sp.get('token') || ''
  const [pw, setPw] = useState('')
  const router = useRouter()
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      await apiPost('/auth/reset-password', { token, new_password: pw })
      toast.success('Пароль изменён')
      router.push('/login')
    } catch (err: unknown) {
      toast.error(errText(err) || 'Ошибка')
    }
  }
  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-4">Новый пароль</h1>
        <form onSubmit={submit} className="space-y-3">
          <input
            className="input"
            type="password"
            placeholder="Новый пароль"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
          />
          <button className="btn w-full">Сохранить</button>
        </form>
      </div>
    </div>
  )
}
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  )
}
