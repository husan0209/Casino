'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'

import { exchangeGoogleCode } from '@/components/auth/OAuthButtons'
import { toast } from '@/components/ui/toaster'
import { errText, setAccessToken } from '@/lib/api'
import { type AuthState, useAuth } from '@/stores/auth'

/**
 * Callback Google OAuth (pre-launch: ТЗ ч.2 UC-AUTH-08). Google возвращает
 * code на redirect_uri (APP_URL/auth/google/callback); страница обменивает
 * его на сессию (POST /auth/google с подписанным state на стороне API) и
 * уводит в профиль. Ошибки (отменённый вход, невалидный state/TTL) — toast.
 */
function GoogleCallbackInner(): React.JSX.Element {
  const router = useRouter()
  const setSession = useAuth((s: AuthState) => s.setSession)
  const [status, setStatus] = useState('Входим через Google…')

  useEffect((): void => {
    exchangeGoogleCode()
      .then((res) => {
        setAccessToken(res.accessToken)
        setSession(res.accessToken, res.user)
        setStatus('Вход выполнен! Перенаправляем…')
        toast.success('Вход через Google выполнен')
        setTimeout(() => router.push('/profile'), 800)
      })
      .catch((err: unknown) => {
        setStatus('Не удалось войти через Google')
        toast.error(errText(err) || 'Ошибка OAuth-входа')
        setTimeout(() => router.push('/login'), 1600)
      })
  }, [router, setSession])

  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card text-center">
        <h1 className="text-lg font-bold mb-2">Google OAuth</h1>
        <p className="text-muted text-sm">{status}</p>
      </div>
    </div>
  )
}

export default function GoogleCallbackPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div className="container-1 py-12 max-w-sm mx-auto" />}>
      <GoogleCallbackInner />
    </Suspense>
  )
}
