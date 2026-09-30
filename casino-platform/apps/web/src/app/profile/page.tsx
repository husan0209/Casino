'use client'

import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { UserAvatar } from '@/components/layout/UserAvatar'
import { SecurityTab, SessionsTab, SettingsTab } from '@/components/profile/ProfileTabs'
import { Field } from '@/components/ui/field'
import { toast } from '@/components/ui/toaster'
import { apiGet, apiPost, errText } from '@/lib/api'
import { uploadAvatar } from '@/lib/api/users.api'
import { kycStatusLabel } from '@/lib/ui/kyc'
import { useAuth } from '@/stores/auth'
import type { MeDto } from '@/types/user'

/**
 * GAP-52 (ТЗ ч.5 §9): личный кабинет — 4 вкладки (Данные / Безопасность /
 * Сессии / Настройки). Тяжёлые вкладки вынесены в ProfileTabs
 * (max-lines-per-function 200 — GAP-39 stage 9b конвенция).
 */
type Tab = 'data' | 'security' | 'sessions' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'data', label: 'Данные' },
  { id: 'security', label: 'Безопасность' },
  { id: 'sessions', label: 'Сессии' },
  { id: 'settings', label: 'Настройки' },
]

const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp']

function DataTab({ me, onSaved }: { me: MeDto; onSaved: () => void }): React.JSX.Element {
  const [form, setForm] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const p = me.profile

  /** GAP-53: аватар — клиентская валидация mime/размера ДО отправки (сервер проверяет magic bytes). */
  const onAvatarPicked = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return
    }
    if (!AVATAR_MIME.includes(file.type)) {
      toast.error('Только JPEG, PNG или WebP')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error('Файл больше 5 МБ')
      return
    }
    try {
      await uploadAvatar(file)
      toast.success('Аватар обновлён')
      onSaved()
    } catch (e: unknown) {
      toast.error(errText(e) || 'Не удалось загрузить аватар')
    }
  }

  const save = async (): Promise<void> => {
    try {
      await apiPost('/users/me/profile', form)
      toast.success('Сохранено')
      onSaved()
    } catch (e: unknown) {
      toast.error(errText(e) || 'Ошибка')
    }
  }

  return (
    <div className="card space-y-3">
      <div className="font-semibold">Личные данные</div>
      <div className="flex items-center gap-3">
        <UserAvatar email={me.user.email} avatarUrl={p?.avatarUrl ?? null} size={56} />
        <div>
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            Сменить аватар
          </button>
          <div className="mt-1 text-xs text-muted">JPEG / PNG / WebP, до 5 МБ</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            void onAvatarPicked(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <Field label="Имя">
        <input
          className="input"
          placeholder="Как к вам обращаться"
          defaultValue={p?.firstName ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
        />
      </Field>
      <Field label="Фамилия">
        <input
          className="input"
          placeholder="Фамилия"
          defaultValue={p?.lastName ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
        />
      </Field>
      <Field label="Страна">
        <input
          className="input"
          placeholder="Например, RU"
          defaultValue={p?.country ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
        />
      </Field>
      <Field label="Город">
        <input
          className="input"
          placeholder="Город"
          defaultValue={p?.city ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
        />
      </Field>
      <button onClick={() => void save()} className="btn w-full">
        Сохранить
      </button>
    </div>
  )
}

export default function ProfilePage(): React.JSX.Element {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState<Tab>('data')

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet<MeDto>('/users/me'),
    enabled: Boolean(user),
  })

  if (!user) {
    return <div className="container-1 py-8">Войдите в аккаунт</div>
  }

  return (
    <div className="container-1 py-6 max-w-3xl">
      <p className="caps-label">ЛИЧНЫЙ КАБИНЕТ</p>
      <h1 className="page-title mb-6">Профиль</h1>
      {isLoading || !data ? (
        'Загрузка…'
      ) : (
        <>
          <div className="card mb-5 flex flex-wrap items-center gap-4">
            <UserAvatar
              email={data.user.email}
              avatarUrl={data.profile?.avatarUrl ?? null}
              size={48}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{data.user.email || 'Игрок'}</div>
              <div className="text-sm text-muted">
                Верификация: {kycStatusLabel(data.kycStatus)}
              </div>
              <div className="text-xs text-muted">
                В игре с {new Date(data.user.createdAt).toLocaleDateString('ru')}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span className="field-label mb-0.5">Код</span>
              <span className="font-mono text-xs text-white/80">{data.user.referralCode}</span>
            </div>
          </div>

          <div className="mb-5 flex gap-2 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm ${
                  tab === t.id ? 'bg-[#6C63FF] text-white' : 'text-muted hover:bg-white/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'data' && <DataTab me={data} onSaved={() => void refetch()} />}
          {tab === 'security' && <SecurityTab me={data} onLogout={logout} />}
          {tab === 'sessions' && <SessionsTab />}
          {tab === 'settings' && <SettingsTab me={data} />}
        </>
      )}
    </div>
  )
}
