'use client'
import Link from 'next/link'
import { useState } from 'react'

import { CaptchaField } from '@/components/auth/CaptchaField'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { toast } from '@/components/ui/toaster'
import { errCode, errText } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'

export function LoginSheet(): React.JSX.Element | null {
  const {
    loginSheet,
    loginSheetMode,
    setLoginSheetMode,
    closeLogin,
    pendingGameSlug,
  } = useUIStore()
  const { login, register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [adult, setAdult] = useState(false)
  const [loading, setLoading] = useState(false)
  // GAP-55 (ж) §5.2: капча появляется только после CAPTCHA_REQUIRED от бэка
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaRequired, setCaptchaRequired] = useState(false)

  if (!loginSheet) {
    return null
  }

  const submit = async (): Promise<void> => {
    setLoading(true)
    try {
      if (loginSheetMode === 'login') {
        await login(email, password, captchaRequired ? captchaToken : undefined)
      } else {
        await register(email, password, referralCode || undefined)
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
        <h2 className="text-lg font-semibold">
          {loginSheetMode === 'login' ? 'Войдите, чтобы играть' : 'Создать аккаунт'}
        </h2>
        <OAuthButtons referralCode={referralCode || undefined} />
        {captchaRequired && loginSheetMode === 'login' && (
          <div className="my-3">
            <CaptchaField onToken={setCaptchaToken} />
          </div>
        )}
        <form
          className="my-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={loginSheetMode === 'register' ? 8 : undefined}
            required
          />
          {loginSheetMode === 'register' && (
            <>
              <input
                className="input"
                placeholder="Реферальный код (необязательно)"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
              />
              <label className="flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[#6C63FF]"
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
            </>
          )}
          <button
            type="submit"
            className="btn w-full"
            disabled={loading || (loginSheetMode === 'register' && !adult)}
          >
            {loading ? '…' : loginSheetMode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>
        <button
          type="button"
          className="text-sm text-muted"
          onClick={() => setLoginSheetMode(loginSheetMode === 'login' ? 'register' : 'login')}
        >
          {loginSheetMode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
        </button>
      </div>
    </>
  )
}
