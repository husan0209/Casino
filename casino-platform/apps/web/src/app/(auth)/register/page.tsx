'use client'

import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { getAffiliateCode } from '@/components/affiliate/AffiliateCodeCapture'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { Logo } from '@/components/layout/Logo'
import { toast } from '@/components/ui/toaster'
import { errText } from '@/lib/api'
import { type AuthState, useAuth } from '@/stores/auth'

function getStrength(pass: string): { label: string; score: number; color: string } {
  if (!pass) {
    return { label: '', score: 0, color: 'bg-transparent' }
  }
  let score = 0
  if (pass.length >= 8) {
    score++
  }
  if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) {
    score++
  }
  if (/[0-9]/.test(pass)) {
    score++
  }
  if (/[^A-Za-z0-9]/.test(pass)) {
    score++
  }

  if (score <= 1) {
    return { label: 'Слабый пароль', score: 1, color: 'bg-[#FF3D71]' }
  }
  if (score <= 2) {
    return { label: 'Средний пароль', score: 2, color: 'bg-[#FFB300]' }
  }
  return { label: 'Надёжный пароль', score: 3, color: 'bg-[#00C853]' }
}

export default function RegisterPage(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [ref, setRef] = useState('')
  const [adult, setAdult] = useState(false)
  const [sent, setSent] = useState(false)
  const register = useAuth((s: AuthState) => s.register)

  const strength = getStrength(password)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      // Два независимых кода: `ref` — игровая рефералка (поле формы),
      // affiliate — партнёрская программа (ТЗ ч.8 §7.3). Сервер резолвит каждый
      // в своей таблице, поэтому передавать можно оба.
      await register(email, password, {
        referral: ref || undefined,
        affiliate: getAffiliateCode() ?? undefined,
      })
      setSent(true)
      toast.success('Письмо отправлено на email')
    } catch (err: unknown) {
      toast.error(errText(err) || 'Ошибка регистрации')
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card w-full max-w-sm text-center">
          <div className="mb-4 flex justify-center">
            <Logo size={40} />
          </div>
          <h1 className="mb-2 text-xl font-bold">Проверьте email</h1>
          <p className="text-sm text-muted">Мы отправили письмо с подтверждением на {email}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size={40} />
        </div>
        <div className="mb-6 text-center">
          <p className="caps-label">НОВЫЙ АККАУНТ</p>
          <h1 className="text-xl font-black text-white">Регистрация</h1>
        </div>

        <OAuthButtons referralCode={ref} />

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
            <label className="mb-1 block text-xs text-muted">Пароль</label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPassword ? 'text' : 'password'}
                placeholder="Мин. 8 символов"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {password && (
              <div className="mt-1.5 space-y-1">
                <div className="flex h-1 gap-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full flex-1 ${strength.score >= 1 ? strength.color : 'opacity-20'}`}
                  />
                  <div
                    className={`h-full flex-1 ${strength.score >= 2 ? strength.color : 'opacity-20'}`}
                  />
                  <div
                    className={`h-full flex-1 ${strength.score >= 3 ? strength.color : 'opacity-20'}`}
                  />
                </div>
                <div className="text-[10px] text-muted">{strength.label}</div>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted">Реферальный код (необязательно)</label>
            <input
              className="input"
              placeholder="Код приглашения"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
              required
            />
            <span>
              Мне 18+ лет. Я принимаю{' '}
              <Link href="/legal/terms" className="text-white underline">
                условия использования
              </Link>{' '}
              и{' '}
              <Link href="/legal/privacy" className="text-white underline">
                политику конфиденциальности
              </Link>
              .
            </span>
          </label>

          <button className="btn w-full py-3" disabled={!adult}>
            Зарегистрироваться
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-muted">
          Есть аккаунт?{' '}
          <Link href="/login" className="text-brand hover:underline">
            Войти
          </Link>
        </div>
      </div>
    </div>
  )
}
