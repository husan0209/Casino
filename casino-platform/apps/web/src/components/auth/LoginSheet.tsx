'use client'
import { ArrowRight, Lock, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { CaptchaField } from '@/components/auth/CaptchaField'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
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

        {/* §4.8: OAuth сверху, ниже — email-форма. Реальный поток у OAuthButtons;
            свои кнопки здесь вели бы в несуществующий callback. */}
        <div className="mt-4">
          <OAuthButtons />
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
                type="password"
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Lock
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden
              />
            </div>
          </div>

          {/* «Запомнить меня» здесь нечего обещать: refresh-токен живёт в памяти
              (localStorage запрещён security-базлайном), сессия не переживает
              перезагрузку ни при каком значении чекбокса. */}

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
