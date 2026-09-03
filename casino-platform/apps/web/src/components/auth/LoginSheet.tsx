'use client'
import { useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { errText } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'

export function LoginSheet(): React.JSX.Element | null {
  const { loginSheet, closeLogin, pendingGameSlug } = useUIStore()
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  if (!loginSheet) {
    return null
  }

  const submit = async (): Promise<void> => {
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password)
      }
      closeLogin()
      if (pendingGameSlug) {
        window.location.href = `/casino/${pendingGameSlug}?launch=1`
      }
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={closeLogin} />
      <div className="sheet-panel">
        <h2 className="text-lg font-semibold">Войдите, чтобы играть</h2>
        <p className="text-sm text-muted mt-1">Google / Telegram — скоро</p>
        <div className="my-4 space-y-3">
          <input
            className="input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="btn w-full" disabled={loading} onClick={submit}>
            {loading ? '…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </div>
        <button
          type="button"
          className="text-sm text-muted"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
        </button>
      </div>
    </>
  )
}
