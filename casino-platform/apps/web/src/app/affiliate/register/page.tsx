'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { PasswordField } from '@/components/ui/password-field'
import { toast } from '@/components/ui/toaster'
import { affiliateErrText } from '@/lib/affiliate-api'
import { type AffiliateAuthState, useAffiliateAuth } from '@/stores/affiliate'

export default function AffiliateRegisterPage(): React.JSX.Element {
  const router = useRouter()
  const register = useAffiliateAuth((s: AffiliateAuthState) => s.register)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [website, setWebsite] = useState('')
  const [telegram, setTelegram] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    // Чекбокс согласия обязателен до запроса: сервер всё равно его требует
    // (accept_terms), но без локальной проверки пользователь получил бы
    // невнятную ошибку вместо понятного сообщения под полем.
    if (!accepted) {
      setError('Примите условия партнёрской программы')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await register({
        email,
        password,
        website: website || undefined,
        telegram: telegram || undefined,
      })
      toast.success('Партнёрский аккаунт создан')
      // Показываем ссылку сразу: без неё партнёр не сможет начать работать.
      router.push(`/affiliate/links?created=${encodeURIComponent(result.tracking_code)}`)
    } catch (err) {
      setError(affiliateErrText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container-1 py-8 max-w-md">
      <p className="caps-label">ПАРТНЁРСКАЯ ПРОГРАММА</p>
      <h1 className="page-title mb-1">Регистрация партнёра</h1>
      <p className="text-muted text-sm mb-6">
        Ссылка выдаётся сразу после регистрации. Выплаты — на баланс кошелька, вывод через обычную
        кассу казино.
      </p>

      {error !== null && (
        <div className="card mb-4 border-[#FF3D71]/40">
          <div className="text-[#FF3D71] text-sm">{error}</div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="aff-email">
            Email
          </label>
          <input
            id="aff-email"
            type="email"
            required
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="partner@example.com"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="aff-pass">
            Пароль
          </label>
          <PasswordField
            id="aff-pass"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Минимум 8 символов"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="aff-site">
            Сайт или канал <span className="text-muted">(необязательно)</span>
          </label>
          <input
            id="aff-site"
            type="url"
            className="input"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="aff-tg">
            Telegram <span className="text-muted">(необязательно)</span>
          </label>
          <input
            id="aff-tg"
            type="text"
            className="input"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="@username"
          />
        </div>

        {/* Согласие — не «галочка для галочки»: от него зависит допуск к рекламе гемблинга */}
        <label className="flex items-start gap-2 text-sm text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Принимаю условия партнёрской программы и подтверждаю, что мне есть 18 лет и я не буду
            рекламировать игру лицам младше 18 лет.
          </span>
        </label>

        <button type="submit" className="btn w-full" disabled={busy}>
          {busy ? 'Создаём…' : 'Создать партнёрский аккаунт'}
        </button>
      </form>

      <p className="text-muted text-sm mt-5 text-center">
        Уже есть аккаунт?{' '}
        <Link href="/affiliate/login" className="text-brand underline">
          Войти
        </Link>
      </p>
    </div>
  )
}
