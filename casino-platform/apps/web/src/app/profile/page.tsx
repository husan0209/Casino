'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { SecurityTab, SessionsTab, SettingsTab } from '@/components/profile/ProfileTabs'
import { toast } from '@/components/ui/toaster'
import { apiGet, apiPost, errText } from '@/lib/api'
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

function DataTab({ me, onSaved }: { me: MeDto; onSaved: () => void }): React.JSX.Element {
  const [form, setForm] = useState<Record<string, string>>({})
  const p = me.profile

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
      <input
        className="input"
        placeholder="Имя"
        defaultValue={p?.firstName ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
      />
      <input
        className="input"
        placeholder="Фамилия"
        defaultValue={p?.lastName ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
      />
      <input
        className="input"
        placeholder="Страна (RU)"
        defaultValue={p?.country ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
      />
      <input
        className="input"
        placeholder="Город"
        defaultValue={p?.city ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
      />
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
    <div className="container-1 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Профиль</h1>
      {isLoading || !data ? (
        'Загрузка…'
      ) : (
        <>
          <div className="card mb-5 flex flex-wrap items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-[#16213E] text-xl">👤</div>
            <div className="flex-1">
              <div className="font-medium">{data.user.email || 'Игрок'}</div>
              <div className="text-sm text-muted">
                KYC: <span className="badge">{data.kycStatus}</span> · с{' '}
                {new Date(data.user.createdAt).toLocaleDateString('ru')}
              </div>
            </div>
            <div className="text-xs text-muted font-mono">{data.user.referralCode}</div>
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
