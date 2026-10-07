'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { exchangeTelegramAuth, telegramPayloadFromQuery } from '@/components/auth/oauth'
import { toast } from '@/components/ui/toaster'
import { errText, setAccessToken } from '@/lib/api'
import { type AuthState, useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'

/**
 * Callback Telegram Login (UC-AUTH-09, redirect-режим data-auth-url). После
 * подтверждения виджет переводит страницу сюда, добавляя данные пользователя
 * (id, auth_date, hash, first_name, …) в query. Страница меняет их на сессию
 * (POST /auth/telegram — подпись проверяет API по токену бота) и уводит в
 * профиль. Ошибки — toast и лист входа на главной. Тихий ?ref= едет в обмен:
 * он лежит в auth-url рядом с полями пользователя.
 */
function TelegramCallbackInner(): React.JSX.Element {
  const router = useRouter()
  const setSession = useAuth((s: AuthState) => s.setSession)
  const [status, setStatus] = useState('Входим через Telegram…')

  useEffect((): void => {
    const query = new URLSearchParams(window.location.search)
    const payload = telegramPayloadFromQuery(query)
    // Поля Telegram от виджета приходят только строками (см. telegram-widget.js:
    // params.push(key + '=' + encodeURIComponent(user[key])) — DTO API совпадает.
    if (payload === null) {
      setStatus('Не удалось войти через Telegram')
      toast.error('Telegram не вернул данные входа')
      setTimeout(() => {
        useUIStore.getState().openLogin(undefined, 'login')
        router.replace('/')
      }, 1600)
      return
    }
    exchangeTelegramAuth(payload, query.get('ref') ?? undefined)
      .then((res) => {
        setAccessToken(res.accessToken)
        setSession(res.accessToken, res.user)
        setStatus('Вход выполнен! Перенаправляем…')
        toast.success('Вход через Telegram выполнен')
        setTimeout(() => router.push('/profile'), 800)
      })
      .catch((err: unknown) => {
        setStatus('Не удалось войти через Telegram')
        toast.error(errText(err) || 'Ошибка OAuth-входа')
        setTimeout(() => {
          useUIStore.getState().openLogin(undefined, 'login')
          router.replace('/')
        }, 1600)
      })
  }, [router, setSession])

  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card text-center">
        <h1 className="text-lg font-bold mb-2">Вход через Telegram</h1>
        <p className="text-muted text-sm">{status}</p>
      </div>
    </div>
  )
}

export default function TelegramCallbackPage(): React.JSX.Element {
  return <TelegramCallbackInner />
}
