'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { errCode, errText } from '@/lib/api'
import {
  changePassword,
  listSessions,
  revokeAllSessions,
  revokeSession,
  updateSettings,
} from '@/lib/api/users.api'
import type { MeDto } from '@/types/user'

/**
 * GAP-52 (ТЗ ч.5 §9): вкладка «Безопасность» профиля — смена пароля
 * (только для email-аккаунтов; OAuth — пояснение без формы по hasPassword)
 * и выход. Вынесена из ProfilePage (max-lines-per-function 200).
 */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) {
    return 'Неизвестное устройство'
  }
  if (/iPhone|iPad|Android|Mobile/i.test(userAgent)) {
    return 'Мобильное устройство'
  }
  if (/Windows/i.test(userAgent)) {
    return 'Windows'
  }
  if (/Mac OS/i.test(userAgent)) {
    return 'macOS'
  }
  if (/Linux/i.test(userAgent)) {
    return 'Linux'
  }
  return 'Другое устройство'
}

export function SecurityTab({ me, onLogout }: { me: MeDto; onLogout: () => void }): React.JSX.Element {
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '' })

  const passwordMutation = useMutation({
    mutationFn: () => changePassword(passwordForm),
    onSuccess: () => {
      toast.success('Пароль изменён. Остальные сессии завершены.')
      setPasswordForm({ current_password: '', new_password: '' })
    },
    onError: (e: unknown) => {
      if (errCode(e) === 'INVALID_CREDENTIALS') {
        toast.error('Неверный текущий пароль')
        return
      }
      toast.error(errText(e) || 'Ошибка')
    },
  })

  return (
    <div className="card space-y-3">
      <div className="font-semibold">Безопасность</div>
      {me.user.hasPassword ? (
        <>
          <input
            className="input"
            type="password"
            placeholder="Текущий пароль"
            value={passwordForm.current_password}
            onChange={(e) => setPasswordForm((f) => ({ ...f, current_password: e.target.value }))}
          />
          <input
            className="input"
            type="password"
            placeholder="Новый пароль (мин. 8 симв., 1 цифра)"
            value={passwordForm.new_password}
            onChange={(e) => setPasswordForm((f) => ({ ...f, new_password: e.target.value }))}
          />
          <button
            type="button"
            disabled={
              passwordMutation.isPending ||
              passwordForm.current_password.length === 0 ||
              passwordForm.new_password.length < 8
            }
            onClick={() => passwordMutation.mutate()}
            className="btn w-full"
          >
            {passwordMutation.isPending ? 'Сохранение…' : 'Сменить пароль'}
          </button>
          <p className="text-xs text-muted">
            После смены пароля все сессии, кроме текущей, будут завершены.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">
          Аккаунт входил через Google/Telegram — пароль не задан. Смена пароля недоступна (нет
          пароля для проверки).
        </p>
      )}
      <hr className="border-[#2A2A4A]" />
      <button type="button" className="btn-ghost w-full" onClick={onLogout}>
        Выйти из аккаунта
      </button>
    </div>
  )
}

/**
 * GAP-52 (ТЗ ч.5 §9): вкладка «Сессии» — IP, устройство, дата,
 * завершить одну / все кроме текущей.
 */
export function SessionsTab(): React.JSX.Element {
  const { data: sessions, refetch } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => listSessions(),
  })

  const revokeOne = useMutation({
    mutationFn: (sessionId: string) => revokeSession(sessionId),
    onSuccess: () => {
      toast.success('Сессия завершена')
      void refetch()
    },
    onError: (e: unknown) => toast.error(errText(e) || 'Ошибка'),
  })

  const revokeAll = useMutation({
    mutationFn: () => revokeAllSessions(),
    onSuccess: (res) => {
      toast.success(`Завершено сессий: ${res.revoked}`)
      void refetch()
    },
    onError: (e: unknown) => toast.error(errText(e) || 'Ошибка'),
  })

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Активные сессии</div>
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-xs"
          disabled={revokeAll.isPending}
          onClick={() => revokeAll.mutate()}
        >
          Завершить все кроме текущей
        </button>
      </div>
      {!sessions ? (
        <div className="text-sm text-muted">Загрузка…</div>
      ) : (
        <ul className="divide-y divide-[#2A2A4A]">
          {sessions.map((sess) => (
            <li key={sess.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <div className="text-sm">
                  {deviceLabel(sess.userAgent)}
                  {sess.isCurrent && (
                    <span className="badge ml-2 bg-[#00C853]/15 text-[#00C853]">текущая</span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  IP {sess.ipAddress || '—'} · {new Date(sess.createdAt).toLocaleString('ru')}
                </div>
              </div>
              {!sess.isCurrent && (
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  disabled={revokeOne.isPending}
                  onClick={() => revokeOne.mutate(sess.id)}
                >
                  Завершить
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * GAP-52 (ТЗ ч.5 §9): вкладка «Настройки» — email-уведомления, часовой
 * пояс. Push — disabled (нет бэка); язык RU — селект не показываем (ТЗ).
 */
export function SettingsTab({ me }: { me: MeDto }): React.JSX.Element {
  const [form, setForm] = useState<{ notifications_email?: boolean; timezone?: string }>({})

  const mutation = useMutation({
    mutationFn: () => updateSettings(form),
    onSuccess: () => toast.success('Настройки сохранены'),
    onError: (e: unknown) => toast.error(errText(e) || 'Ошибка'),
  })

  const s = me.settings

  return (
    <div className="card space-y-4">
      <div className="font-semibold">Настройки</div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Email-уведомления</span>
        <input
          type="checkbox"
          defaultChecked={s?.notificationsEmail ?? true}
          onChange={(e) => setForm((f) => ({ ...f, notifications_email: e.target.checked }))}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Push-уведомления</span>
        <input type="checkbox" defaultChecked={s?.notificationsPush ?? false} disabled className="opacity-50" />
      </label>
      <label className="block space-y-2 text-sm">
        <span className="text-muted">Часовой пояс</span>
        <select
          className="input"
          defaultValue={s?.timezone ?? 'Europe/Moscow'}
          onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
        >
          {['Europe/Moscow', 'Europe/Kiev', 'Asia/Almaty', 'Asia/Tashkent', 'Europe/Minsk'].map(
            (tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ),
          )}
        </select>
      </label>
      <button
        type="button"
        className="btn w-full"
        disabled={mutation.isPending || Object.keys(form).length === 0}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Сохранение…' : 'Сохранить'}
      </button>
    </div>
  )
}
