'use client'
import { ArrowRight, Eye, EyeOff, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { CaptchaField } from '@/components/auth/CaptchaField'
import { toast } from '@/components/ui/toaster'
import { errCode, errText } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'

/**
 * LoginSheet (ТЗ ч.5.1 §4.8, донор VANTA): нижний лист «Войдите, чтобы играть».
 * Google и Telegram сверху, ниже email-форма, ссылка на регистрацию.
 * После успеха — продолжить launch, не выкидывать на главную.
 */
export function LoginSheet(): React.JSX.Element | null {
  const { loginSheet, closeLogin, pendingGameSlug } = useUIStore()
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaRequired, setCaptchaRequired] = useState(false)

  if (!loginSheet) {
    return null
  }

  const submit = async (): Promise<void> => {
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password, captchaRequired ? captchaToken : undefined)
      } else {
        await register(email, password)
      }
      closeLogin()
      if (pendingGameSlug) {
        window.location.href = `/casino/${pendingGameSlug}?launch=1`
      }
    } catch (e) {
      const code = errCode(e)
      if (code === 'CAPTCHA_REQUIRED') {
        setCaptchaRequired(true)
        toast.error('Слишком много попыток — подтвердите, что вы не робот')
      } else if (code === 'CAPTCHA_FAILED') {
        setCaptchaToken('')
        toast.error('Капча не пройдена, попробуйте ещё раз')
      } else {
        toast.error(errText(e))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={closeLogin} />
      <div className="sheet-panel">
        <div className="sheet-handle" />
        <div className="flex items-center justify-between">
          <div>
            <p className="caps-label">ДОБРО ПОЖАЛОВАТЬ</p>
            <h2 className="text-lg font-bold">
              {mode === 'login' ? 'Войдите, чтобы играть' : 'Создать аккаунт'}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeLogin}
            aria-label="Закрыть"
            className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-white"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* OAuth кнопки — §4.8: Google и Telegram сверху */}
        <div className="mt-4 space-y-2.5">
          <Link
            href="/google/callback"
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#2A2A4A] bg-white/[0.04] px-4 py-3 text-sm font-medium transition hover:bg-white/[0.07]"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-sm font-bold text-[#4285F4]">
              G
            </span>
            Продолжить с Google
          </Link>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#2A2A4A] bg-white/[0.04] px-4 py-3 text-sm font-medium transition hover:bg-white/[0.07]"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[#0088CC] text-sm font-bold text-white">
              ▶
            </span>
            Войти через Telegram
          </button>
        </div>

        {/* Разделитель */}
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-[#2A2A4A]" />
          <span className="text-xs text-muted">или по email</span>
          <div className="h-px flex-1 bg-[#2A2A4A]" />
        </div>

        {captchaRequired && mode === 'login' && (
          <div className="mb-3">
            <CaptchaField onToken={setCaptchaToken} />
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted">Email</label>
            <input
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between text-xs text-muted">
              <span>Пароль</span>
              {mode === 'login' && (
                <Link
                  href="/forgot-password"
                  className="text-brand hover:underline"
                  onClick={closeLogin}
                >
                  Забыли пароль?
                </Link>
              )}
            </label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPassword ? 'text' : 'password'}
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-white"
              >
                {showPassword ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              </button>
            </div>
          </div>

          {mode === 'login' && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                defaultChecked
                className="rounded border-[#2A2A4A] bg-[#1A1A2E] accent-brand"
              />
              Запомнить меня
            </label>
          )}

          <button
            type="button"
            className="btn w-full py-3"
            disabled={loading}
            onClick={() => void submit()}
          >
            {loading ? '…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            {!loading && <ArrowRight size={16} aria-hidden />}
          </button>
        </div>

        <p className="mt-4 text-center text-sm text-muted">
          {mode === 'login' ? (
            <>
              Нет аккаунта?{' '}
              <button
                type="button"
                className="font-medium text-brand hover:underline"
                onClick={() => setMode('register')}
              >
                Зарегистрироваться
              </button>
            </>
          ) : (
            <>
              Уже есть аккаунт?{' '}
              <button
                type="button"
                className="font-medium text-brand hover:underline"
                onClick={() => setMode('login')}
              >
                Войти
              </button>
            </>
          )}
        </p>
      </div>
    </>
  )
}
