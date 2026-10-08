'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useState, Suspense } from 'react'

import { PasswordStrengthMeter } from '@/components/auth/PasswordStrength'
import { PasswordField } from '@/components/ui/password-field'
import { toast } from '@/components/ui/toaster'
import { apiPost, errText } from '@/lib/api'

/**
 * Правило зеркалит `ResetPasswordSchema` на API (мин. 8 и хотя бы одна цифра).
 * Сверяем до отправки не ради экономии запроса: ссылка сброса одноразовая, и
 * получить «невалидный токен» после опечатки в пароле — значит потерять доступ к
 * форме, в которую уже всё введено.
 */
function passwordProblem(password: string, repeat: string): string | null {
  if (password.length < 8) {
    return 'Минимум 8 символов'
  }
  if (!/\d/.test(password)) {
    return 'Пароль должен содержать минимум 1 цифру'
  }
  if (repeat !== password) {
    return 'Пароли не совпадают'
  }
  return null
}

function ResetInner(): React.JSX.Element {
  const sp = useSearchParams()
  const token = sp.get('token') || ''
  const [pw, setPw] = useState('')
  const [repeat, setRepeat] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const mismatch = passwordProblem(pw, repeat)
    if (mismatch !== null) {
      setProblem(mismatch)
      return
    }
    setProblem(null)
    setBusy(true)
    try {
      await apiPost<unknown>('/auth/reset-password', { token, new_password: pw })
      toast.success('Пароль изменён')
      router.push('/login')
    } catch (err: unknown) {
      toast.error(errText(err) || 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-4">Новый пароль</h1>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div>
            <label className="field-label" htmlFor="new-password">
              Новый пароль
            </label>
            <PasswordField
              id="new-password"
              placeholder="Мин. 8 символов, с цифрой"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => {
                setPw(e.target.value)
                setProblem(null)
              }}
              required
            />
            <PasswordStrengthMeter password={pw} />
          </div>
          <div>
            <label className="field-label" htmlFor="repeat-password">
              Повторите пароль
            </label>
            <PasswordField
              id="repeat-password"
              placeholder="Ещё раз тот же пароль"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => {
                setRepeat(e.target.value)
                setProblem(null)
              }}
              aria-invalid={problem !== null}
              required
            />
            {problem !== null ? (
              <p className="mt-1 text-xs text-[#FF3D71]" role="alert">
                {problem}
              </p>
            ) : null}
          </div>
          <button className="btn w-full" disabled={busy}>
            Сохранить
          </button>
        </form>
      </div>
    </div>
  )
}

export default function ResetPasswordPage(): React.JSX.Element {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  )
}
