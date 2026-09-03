'use client'
import axios from 'axios'
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'

import { errText, setAccessToken } from '@/lib/api'
import { type AuthState, useAuth } from '@/stores/auth'
import type { WebUser } from '@/stores/auth'

function VerifyInner(): React.JSX.Element {
  const sp = useSearchParams()
  const token = sp.get('token')
  const router = useRouter()
  const setAuth = useAuth((s: AuthState) => s.setAuth)
  const [status, setStatus] = useState('Проверка…')
  useEffect(() => {
    if (!token) {
      setStatus('Нет токена')
      return
    }
    axios
      .get(
        (process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1') +
          '/auth/verify-email?token=' +
          token,
      )
      .then((r) => {
        const d = (r.data.data ?? r.data) as { accessToken?: string; user?: WebUser }
        if (d.accessToken && d.user) {
          setAuth(d.user, d.accessToken)
          setAccessToken(d.accessToken)
        }
        setStatus('Email подтверждён! Перенаправляем…')
        setTimeout(() => router.push('/profile'), 1200)
      })
      .catch((e: unknown) =>
        setStatus('Ошибка: ' + (errText(e) || 'неверный токен')),
      )
  }, [token, router, setAuth])
  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card text-center">{status}</div>
    </div>
  )
}
export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  )
}
