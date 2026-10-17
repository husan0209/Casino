'use client'
import Link from 'next/link'
import { useState } from 'react'

import { type AffiliateAuthState, useAffiliateAuth } from '@/stores/affiliate'

/**
 * Запрос ссылки на восстановление партнёрского пароля.
 *
 * Экран даёт ОДИН ответ на любой email — известный и неизвестный выглядят
 * одинаково. Это не косметика: API всегда возвращает 200 с нейтральной фразой
 * именно для того, чтобы по форме нельзя было перебрать, какие партнёрские
 * аккаунты существуют. Любая локальная ветка «такого email нет» открыла бы
 * канал перебора обратно.
 *
 * Отдельная страница (а не игровая `/forgot-password`) нужна потому, что
 * партнёрские креды живут в таблице `affiliates`, а игровой сброс ищет email
 * в `users` — для партнёра он всегда NULL.
 */
export default function AffiliateForgotPasswordPage(): React.JSX.Element {
  const forgotPassword = useAffiliateAuth((state: AffiliateAuthState) => state.forgotPassword)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await forgotPassword(email.trim())
      setSent(true)
    } catch {
      // Запрос не дошёл (сеть / 5xx) — сказать «письмо отправлено» было бы
      // неправдой. Текст нейтральный по существованию аккаунта: он ничего не
      // сообщает про email.
      setError('Не удалось отправить запрос. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container-1 py-8 max-w-md">
      <p className="caps-label">ПАРТНЁРСКАЯ ПРОГРАММА</p>
      <h1 className="page-title mb-1">Восстановление доступа</h1>
      <p className="text-muted text-sm mb-6">
        Напоминание для партнёрского аккаунта. Если вы игрок, а не партнёр, воспользуйтесь
        восстановлением пароля в профиле игрока.
      </p>

      {error !== null && (
        <div className="card mb-4 border-[#FF3D71]/40">
          <div className="text-[#FF3D71] text-sm" role="alert">
            {error}
          </div>
        </div>
      )}

      {sent ? (
        <div className="card" role="status">
          <div className="font-semibold mb-1">Проверьте почту</div>
          <p className="text-muted text-sm">
            Если такой email есть в партнёрской программе, ссылка для смены пароля отправлена.
          </p>
          <p className="text-muted text-xs mt-2">
            Ссылка живёт один час и действует один раз. Письмо может попасть в «Спам».
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="field-label" htmlFor="aff-forgot-email">
              Email партнёрского аккаунта
            </label>
            <input
              id="aff-forgot-email"
              type="email"
              required
              autoComplete="email"
              className="input"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setError(null)
              }}
              placeholder="partner@example.com"
            />
          </div>
          <button type="submit" className="btn w-full min-h-[44px]" disabled={busy}>
            {busy ? 'Отправляем…' : 'Отправить ссылку'}
          </button>
        </form>
      )}

      <div className="mt-5 text-center">
        <Link
          href="/affiliate/login"
          className="inline-flex min-h-[44px] items-center text-brand underline text-sm"
        >
          Назад ко входу
        </Link>
      </div>
    </div>
  )
}
