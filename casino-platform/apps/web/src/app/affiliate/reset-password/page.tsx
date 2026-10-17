'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { PasswordStrengthMeter } from '@/components/auth/PasswordStrength'
import { PasswordField } from '@/components/ui/password-field'
import { toast } from '@/components/ui/toaster'
import { affiliatePasswordErrText } from '@/lib/affiliate-api'
import {
  AFFILIATE_PASSWORD_TOO_SHORT_TEXT,
  affiliatePasswordProblem,
} from '@/lib/ui/affiliate-password'
import { type AffiliateAuthState, useAffiliateAuth } from '@/stores/affiliate'

/**
 * Смена партнёрского пароля по ссылке из письма.
 *
 * Полей два (новый + повтор), хотя API принимает одно: ссылка одноразовая, и
 * опечатка в единственном поле означала бы «поставил пароль, которого не знаю»,
 * причём обнаружилось бы это только при следующем входе.
 *
 * Тексты ошибок берём из стабильных кодов (`AFFILIATE_TOKEN_*`, `WEAK_PASSWORD`)
 * — см. lib/ui/affiliate-password: там же живёт и русская формулировка.
 */
function ResetInner(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const resetPassword = useAffiliateAuth((state: AffiliateAuthState) => state.resetPassword)

  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Ссылка без токена не ведёт никуда, поэтому ранний выход — вместо формы с
  // двумя полями и кнопкой: партнёру нужен новый запрос, а не попытка угадать
  // токен и сжечь его отказом API.
  if (token === '') {
    return (
      <div className="container-1 py-8 max-w-md">
        <p className="caps-label">ПАРТНЁРСКАЯ ПРОГРАММА</p>
        <h1 className="page-title mb-1">Новый пароль</h1>
        <div className="card" role="status">
          <p className="text-muted text-sm">
            В ссылке нет токена восстановления — возможно, она скопирована не целиком.
          </p>
          <Link
            href="/affiliate/forgot-password"
            className="inline-flex min-h-[44px] items-center text-brand underline text-sm"
          >
            Запросить новую ссылку
          </Link>
        </div>
      </div>
    )
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const problem = affiliatePasswordProblem(password, repeat)
    if (problem !== null) {
      setHint(problem)
      return
    }
    setHint(null)
    setError(null)
    setBusy(true)
    try {
      await resetPassword(token, password)
      toast.success('Пароль изменён')
      router.replace('/affiliate/login')
    } catch (err: unknown) {
      setError(affiliatePasswordErrText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container-1 py-8 max-w-md">
      <p className="caps-label">ПАРТНЁРСКАЯ ПРОГРАММА</p>
      <h1 className="page-title mb-1">Новый пароль</h1>
      <p className="text-muted text-sm mb-6">
        Придумайте пароль для партнёрского аккаунта. После смены ссылка перестанет работать, а
        текущие сессии партнёра будут закрыты.
      </p>

      {error !== null && (
        <div className="card mb-4 border-[#FF3D71]/40">
          <div className="text-[#FF3D71] text-sm" role="alert">
            {error}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="aff-new-password">
            Новый пароль
          </label>
          <PasswordField
            id="aff-new-password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setHint(null)
              setError(null)
            }}
            placeholder={AFFILIATE_PASSWORD_TOO_SHORT_TEXT}
          />
          <PasswordStrengthMeter password={password} />
        </div>

        <div>
          <label className="field-label" htmlFor="aff-repeat-password">
            Повторите пароль
          </label>
          <PasswordField
            id="aff-repeat-password"
            required
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => {
              setRepeat(event.target.value)
              setHint(null)
              setError(null)
            }}
            aria-invalid={hint !== null}
            placeholder="Ещё раз тот же пароль"
          />
          {hint !== null && (
            <p className="mt-1 text-xs text-[#FF3D71]" role="alert">
              {hint}
            </p>
          )}
        </div>

        <button type="submit" className="btn w-full min-h-[44px]" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сменить пароль'}
        </button>
      </form>

      <div className="mt-5 text-center">
        <Link
          href="/affiliate/forgot-password"
          className="inline-flex min-h-[44px] items-center text-brand underline text-sm"
        >
          Ссылка не открылась? Запросить новую
        </Link>
      </div>
    </div>
  )
}

export default function AffiliateResetPasswordPage(): React.JSX.Element {
  // useSearchParams требует Suspense в Next 14 при статической генерации
  // (тот же приём, что на игровой /reset-password и в кабинете /affiliate/links).
  return (
    <Suspense fallback={<div className="text-muted text-sm py-6">Загрузка…</div>}>
      <ResetInner />
    </Suspense>
  )
}
