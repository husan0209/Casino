'use client'
import { ArrowRight, Eye, EyeOff, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { getAffiliateCode } from '@/components/affiliate/AffiliateCodeCapture'
import { CaptchaField } from '@/components/auth/CaptchaField'
import {
  GOOGLE_CLIENT_ID,
  GoogleMark,
  OAUTH_BUTTON_CLASS,
  TelegramMark,
  startGoogleOAuth,
} from '@/components/auth/oauth'
import { toast } from '@/components/ui/toaster'
import { errCode, errText } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { type LoginSheetMode, useUIStore } from '@/stores/ui'

import { LEGAL_DOCUMENT_VERSIONS } from '@casino/shared-types'

/** §5.1: индикатор силы вместо отдельного «подтвердите пароль». */
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
  return { label: 'Надёжный пароль', score: 3, color: 'bg-money' }
}

/** §5.1: реферальный код подставляется тихо из ?ref=, поля в форме нет. */
function getQuietReferral(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return new URLSearchParams(window.location.search).get('ref') ?? undefined
}

/** §4.8: OAuth сверху — Google и Telegram; Google включается при наличии ключа. */
function OAuthSection({ referral }: { referral: string | undefined }): React.JSX.Element {
  return (
    <div className="mt-4 space-y-2.5">
      {GOOGLE_CLIENT_ID !== undefined ? (
        <button
          type="button"
          className={OAUTH_BUTTON_CLASS}
          onClick={() => void startGoogleOAuth(referral)}
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
            <GoogleMark size={14} />
          </span>
          Продолжить с Google
        </button>
      ) : (
        <Link href="/auth/google/callback" className={OAUTH_BUTTON_CLASS}>
          <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
            <GoogleMark size={14} />
          </span>
          Продолжить с Google
        </Link>
      )}
      {/* Виджет Telegram (UC-AUTH-09) — после настройки бота и домена, тот же контур, что GAP-46. */}
      <button type="button" className={OAUTH_BUTTON_CLASS}>
        <TelegramMark size={24} />
        Войти через Telegram
      </button>
    </div>
  )
}

function PasswordStrengthMeter({ password }: { password: string }): React.JSX.Element | null {
  if (password === '') {
    return null
  }
  const strength = getStrength(password)
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex h-1 gap-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full flex-1 ${strength.score >= 1 ? strength.color : 'opacity-20'}`} />
        <div className={`h-full flex-1 ${strength.score >= 2 ? strength.color : 'opacity-20'}`} />
        <div className={`h-full flex-1 ${strength.score >= 3 ? strength.color : 'opacity-20'}`} />
      </div>
      <div className="text-[10px] text-muted">{strength.label}</div>
    </div>
  )
}

function TermsConsent({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2 text-xs text-muted">
      <input
        type="checkbox"
        className="mt-0.5 accent-brand"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
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
  )
}

/** Ссылка внизу листа: переключение вход ↔ регистрация без перезагрузок. */
function ModeSwitch({
  mode,
  onSwitch,
}: {
  mode: LoginSheetMode
  onSwitch: (next: LoginSheetMode) => void
}): React.JSX.Element {
  return (
    <p className="mt-4 text-center text-sm text-muted">
      {mode === 'login' ? (
        <>
          Нет аккаунта?{' '}
          <button
            type="button"
            className="font-medium text-brand hover:underline"
            onClick={() => onSwitch('register')}
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
            onClick={() => onSwitch('login')}
          >
            Войти
          </button>
        </>
      )}
    </p>
  )
}

/**
 * LoginSheet (ТЗ ч.5 §5, ч.5.1 §4.8): ЕДИНСТВЕННАЯ точка входа и регистрации.
 * Открывается из шапки («Войти»/«Регистрация»), при запуске игры гостем и по
 * старым ссылкам /login и /register. Два режима: вход и регистрация; Google и
 * Telegram сверху, ниже email-форма. После успеха — продолжить launch,
 * не выкидывать на главную.
 */
export function LoginSheet(): React.JSX.Element | null {
  const { loginSheet, loginSheetClosing, loginSheetMode, closeLogin, pendingGameSlug } =
    useUIStore()
  const { login, register } = useAuth()
  const [mode, setMode] = useState<LoginSheetMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [adult, setAdult] = useState(false)
  const [loading, setLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaRequired, setCaptchaRequired] = useState(false)

  // Открытие листа всегда в режиме, который попросили (шапка, редиректы /login|/register).
  useEffect(() => {
    if (loginSheet) {
      setMode(loginSheetMode)
    }
  }, [loginSheet, loginSheetMode])

  if (!loginSheet && !loginSheetClosing) {
    return null
  }

  const referral = getQuietReferral()

  const switchMode = (next: LoginSheetMode): void => {
    setMode(next)
    setCaptchaRequired(false)
    setCaptchaToken('')
  }

  const afterAuth = (): void => {
    closeLogin()
    if (pendingGameSlug) {
      window.location.href = `/casino/${pendingGameSlug}?launch=1`
    }
  }

  const submit = async (): Promise<void> => {
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password, captchaRequired ? captchaToken : undefined)
      } else {
        // §5.1: сессия создаётся сразу, письмо подтверждения уходит фоном.
        // Версия условий берётся из того же реестра, что и текст на /legal/terms:
        // сервер сверит её и запишет акцепт (GAP-71, Terms §4).
        await register(email, password, {
          referral,
          affiliate: getAffiliateCode() ?? undefined,
          termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
        })
        toast.success('Аккаунт создан')
      }
      afterAuth()
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
      <div className={`sheet-backdrop${loginSheetClosing ? ' sheet-backdrop-out' : ""}`} onClick={closeLogin} />
      <div className={`sheet-panel${loginSheetClosing ? ' sheet-panel-out' : ""}`}>
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

        <OAuthSection referral={referral} />

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
            <label className="mb-1 block text-xs text-muted" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete={mode === 'login' ? 'username' : 'email'}
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-muted" htmlFor="auth-password">
                Пароль
              </label>
              {mode === 'login' && (
                <Link
                  href="/forgot-password"
                  className="text-xs text-brand hover:underline"
                  onClick={closeLogin}
                >
                  Забыли пароль?
                </Link>
              )}
            </div>
            <div className="relative">
              <input
                id="auth-password"
                name="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="input pr-10"
                type={showPassword ? 'text' : 'password'}
                placeholder={mode === 'login' ? 'Введите пароль' : 'Мин. 8 символов'}
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
            {mode === 'register' && <PasswordStrengthMeter password={password} />}
          </div>

          {mode === 'login' ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                defaultChecked
                className="rounded border-[#2A2A4A] bg-[#1A1A2E] accent-brand"
              />
              Запомнить меня
            </label>
          ) : (
            <TermsConsent checked={adult} onChange={setAdult} />
          )}

          <button
            type="button"
            className="btn w-full py-3"
            disabled={loading || (mode === 'register' && !adult)}
            onClick={() => void submit()}
          >
            {loading ? '…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            {!loading && <ArrowRight size={16} aria-hidden />}
          </button>
        </div>

        <ModeSwitch mode={mode} onSwitch={switchMode} />
      </div>
    </>
  )
}
