'use client'
import { useState } from 'react'

import { CaptchaField } from '@/components/auth/CaptchaField'
import { toast } from '@/components/ui/toaster'
import { errCode, errText } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'

export function LoginSheet(): React.JSX.Element | null {
  const { loginSheet, closeLogin, pendingGameSlug } = useUIStore()
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
        <h2 className="text-lg font-semibold">Войдите, чтобы играть</h2>
        <p className="text-sm text-muted mt-1">Google / Telegram — скоро</p>
        {captchaRequired && mode === 'login' && (
          <div className="my-3">
            <CaptchaField onToken={setCaptchaToken} />
          </div>
        )}
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
