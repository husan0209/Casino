'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { affiliateErrText } from '@/lib/affiliate-api'
import { type AffiliateAuthState, useAffiliateAuth } from '@/stores/affiliate'

export default function AffiliateLoginPage(): React.JSX.Element {
  const router = useRouter()
  const login = useAffiliateAuth((s: AffiliateAuthState) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      router.replace('/affiliate/dashboard')
    } catch (err) {
      // Сервер намеренно отдаёт одну общую ошибку и для неверного пароля, и для
      // suspended-партнёра — чтобы нельзя было перебором узнать, какие email
      // зарегистрированы. Поэтому не пытаемся «уточнить» текст здесь.
      setError(affiliateErrText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container-1 py-8 max-w-md">
      <p className="caps-label">ПАРТНЁРСКАЯ ПРОГРАММА</p>
      <h1 className="page-title mb-1">Вход в кабинет</h1>
      <p className="text-muted text-sm mb-6">
        Используйте email партнёрского аккаунта — он может отличаться от игрового.
      </p>

      {error !== null && (
        <div className="card mb-4 border-[#FF3D71]/40">
          <div className="text-[#FF3D71] text-sm">{error}</div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="login-pass">
            Пароль
          </label>
          <input
            id="login-pass"
            type="password"
            required
            autoComplete="current-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn w-full" disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>

      <p className="text-muted text-sm mt-5 text-center">
        Нет аккаунта?{' '}
        <Link href="/affiliate/register" className="text-brand underline">
          Стать партнёром
        </Link>
      </p>
    </div>
  )
}
