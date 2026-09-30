'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { CaptchaField } from '@/components/auth/CaptchaField'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { Logo } from '@/components/layout/Logo'
import { toast } from '@/components/ui/toaster'
import { errCode, errText } from '@/lib/api'
import { type AuthState, useAuth } from '@/stores/auth'

export default function LoginPage(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaRequired, setCaptchaRequired] = useState(false)
  const login = useAuth((s: AuthState) => s.login)
  const router = useRouter()

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password, captchaRequired ? captchaToken : undefined)
      toast.success('Вход выполнен')
      router.push('/profile')
    } catch (err: unknown) {
      if (errCode(err) === 'CAPTCHA_REQUIRED') {
        setCaptchaRequired(true)
        toast.error('Слишком много попыток — подтвердите, что вы не робот')
        return
      }
      if (errCode(err) === 'CAPTCHA_FAILED') {
        setCaptchaToken('')
        toast.error('Капча не пройдена, попробуйте ещё раз')
        return
      }
      toast.error(errText(err) || 'Ошибка входа')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size={40} />
        </div>
        <div className="mb-6 text-center">
          <p className="caps-label">РАДЫ ВИДЕТЬ</p>
          <h1 className="text-xl font-black text-white">Войдите, чтобы играть</h1>
        </div>

        <OAuthButtons />

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted">Email</label>
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted">
              <label>Пароль</label>
              <Link href="/forgot-password" className="text-brand hover:underline">
                Забыли пароль?
              </Link>
            </div>
            <input
              className="input"
              type="password"
              placeholder="Введите пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {captchaRequired && (
            <div className="my-2">
              <CaptchaField onToken={setCaptchaToken} />
            </div>
          )}

          <button className="btn w-full py-3" disabled={loading}>
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-muted">
          Нет аккаунта?{' '}
          <Link href="/register" className="text-brand hover:underline">
            Зарегистрироваться
          </Link>
        </div>
      </div>
    </div>
  )
}
