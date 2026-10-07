'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  exchangeTelegramAuth,
  previewTelegramAuth,
  TelegramMark,
  telegramPayloadFromHash,
  telegramPayloadFromQuery,
  type TelegramAuthPayload,
  type TelegramPreviewResult,
} from '@/components/auth/oauth'
import { toast } from '@/components/ui/toaster'
import { errText, setAccessToken } from '@/lib/api'
import { type AuthState, useAuth } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'

/**
 * Callback Telegram Login (UC-AUTH-09): сюда Telegram возвращает игрока после
 * подтверждения — с результатом в `#tgAuthResult` (прямой заход на
 * oauth.telegram.org/auth) или в query (redirect-режим виджета).
 *
 * Подтверждение игрока — наше, а не Telegram. Сначала проверяем подпись
 * (POST /auth/telegram/preview — он не выдаёт сессию) и показываем, под каким
 * аккаунтом идёт вход и будет ли создан новый; сессия получается только по
 * кнопке «Продолжить». До неё ни пользователя, ни входа нет, поэтому «Отмена»
 * действительно ничего не меняет. У Google этот экран рисует сам Google; у
 * Telegram своего экрана нет, и без нашего вход выглядел бы молчаливой
 * регистрацией.
 *
 * Имя и фото берём из проверенного ответа API, а не из URL: URL подделывается
 * ссылкой `…/callback?first_name=Админ`, и наша страница предлагала бы вход под
 * выдуманным аккаунтом.
 *
 * Реквизиты выметаются из адресной строки сразу после чтения (и query, и хэш):
 * id + auth_date + hash — готовый токен входа с суточным TTL, и без чистки он
 * остаётся в адресной строке и в истории браузера (на общем компьютере его
 * можно перезалить).
 */

type Stage = 'checking' | 'confirm' | 'submitting' | 'done' | 'failed'

function TelegramCallbackInner(): React.JSX.Element {
  const router = useRouter()
  const setSession = useAuth((s: AuthState) => s.setSession)
  const [stage, setStage] = useState<Stage>('checking')
  const [payload, setPayload] = useState<TelegramAuthPayload | null>(null)
  const [preview, setPreview] = useState<TelegramPreviewResult | null>(null)
  const [referral, setReferral] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  /** Уводит обратно на лист входа: страница сама по себе тупиковая. */
  function backToLogin(): void {
    useUIStore.getState().openLogin(undefined, 'login')
    router.replace('/')
  }

  useEffect((): void => {
    const query = new URLSearchParams(window.location.search)
    // Результат приходит либо хэшем (`#tgAuthResult` — прямой заход на
    // oauth.telegram.org/auth), либо query (redirect-режим виджета). Оба
    // контракта принадлежат Telegram, и оба он может вернуть на один и тот же
    // return_to — читать надо оба, иначе вход молча встанет.
    const parsed = telegramPayloadFromHash() ?? telegramPayloadFromQuery(query)
    // Поля Telegram от виджета приходят только строками (см. telegram-widget.js:
    // params.push(key + '=' + encodeURIComponent(user[key])) — DTO API совпадает.
    if (parsed === null) {
      setStage('failed')
      setError('Telegram не вернул данные входа')
      toast.error('Telegram не вернул данные входа')
      return
    }
    setPayload(parsed)
    const ref = query.get('ref')
    setReferral(ref ?? undefined)
    // Только ?ref переживает чтение: всё остальное — реквизиты входа.
    window.history.replaceState(
      null,
      '',
      ref === null
        ? '/auth/telegram/callback'
        : `/auth/telegram/callback?ref=${encodeURIComponent(ref)}`,
    )

    previewTelegramAuth(parsed)
      .then((result): void => {
        setPreview(result)
        setStage('confirm')
      })
      .catch((err: unknown): void => {
        setStage('failed')
        const text = errText(err) || 'Ошибка OAuth-входа'
        setError(text)
        toast.error(text)
      })
    // Только при входе на страницу: повторный запуск уже без очищенного query
    // дал бы «Telegram не вернул данные входа».
  }, [])

  async function confirm(): Promise<void> {
    if (payload === null) {
      return
    }
    setStage('submitting')
    try {
      const res = await exchangeTelegramAuth(payload, referral)
      setAccessToken(res.accessToken)
      setSession(res.accessToken, res.user)
      setStage('done')
      toast.success('Вход через Telegram выполнен')
      setTimeout(() => router.push('/profile'), 600)
    } catch (err: unknown) {
      setStage('failed')
      const text = errText(err) || 'Ошибка OAuth-входа'
      setError(text)
      toast.error(text)
    }
  }

  const registering = preview !== null && !preview.accountExists
  const title =
    stage === 'failed'
      ? 'Не удалось войти через Telegram'
      : stage === 'confirm' && registering
        ? 'Регистрация через Telegram'
        : 'Вход через Telegram'
  const status =
    stage === 'checking'
      ? 'Проверяем данные Telegram…'
      : stage === 'submitting'
        ? 'Входим…'
        : stage === 'done'
          ? 'Вход выполнен! Перенаправляем…'
          : stage === 'failed'
            ? (error ?? 'Ошибка OAuth-входа')
            : registering
              ? 'Аккаунта с этим Telegram нет — создадим новый, без пароля. Зарегистрировать его?'
              : 'Этот Telegram уже привязан к аккаунту. Продолжить вход?'

  return (
    <div className="container-1 py-12 max-w-sm mx-auto">
      <div className="card text-center">
        <h1 className="text-lg font-bold mb-2">{title}</h1>
        {stage === 'confirm' && preview !== null ? (
          <div className="mb-3 flex items-center justify-center gap-3">
            {preview.photoUrl !== null ? (
              <img
                src={preview.photoUrl}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.06]">
                <TelegramMark size={24} />
              </span>
            )}
            <span className="text-left">
              <span className="block text-sm font-medium">
                {preview.displayName ?? 'Аккаунт без имени'}
              </span>
              {preview.username !== null ? (
                <span className="block text-xs text-muted">@{preview.username}</span>
              ) : null}
            </span>
          </div>
        ) : null}
        <p className="text-muted text-sm">{status}</p>
        {stage === 'confirm' ? (
          <div className="mt-4 space-y-2">
            <button type="button" className="btn w-full" onClick={() => void confirm()}>
              Продолжить
            </button>
            <button type="button" className="btn-ghost w-full" onClick={backToLogin}>
              Отмена
            </button>
            <p className="pt-1 text-xs text-muted">
              Не ваш аккаунт? Отмените и войдите через нужный Telegram.
            </p>
          </div>
        ) : null}
        {stage === 'failed' ? (
          <button type="button" className="btn-ghost mt-4 w-full" onClick={backToLogin}>
            Вернуться ко входу
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function TelegramCallbackPage(): React.JSX.Element {
  return <TelegramCallbackInner />
}
