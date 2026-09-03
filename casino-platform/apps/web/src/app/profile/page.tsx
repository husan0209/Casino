'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { apiGet, apiPost } from '@/lib/api'
import type { MeDto } from '@/types/user'
import { useAuth } from '@/stores/auth'

export default function ProfilePage() {
  const { user } = useAuth()
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet<MeDto>('/users/me'),
    enabled: Boolean(user),
  })
  const [form, setForm] = useState<Record<string, string>>({})
  if (!user) {
    return <div className="container-1 py-8">Войдите в аккаунт</div>
  }
  const p = data?.profile
  const save = async () => {
    try {
      await apiPost('/users/me/profile', form)
      toast.success('Сохранено')
      void refetch()
    } catch (e: unknown) {
      toast.error(
        (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Ошибка',
      )
    }
  }
  return (
    <div className="container-1 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Профиль</h1>
      {isLoading ? (
        'Загрузка…'
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="card space-y-3">
            <div className="text-sm text-muted">Email</div>
            <div>{data.user.email}</div>
            <div className="text-sm text-muted">KYC статус</div>
            <div>
              <span className="badge">{data.kycStatus}</span>
            </div>
            <div className="text-sm text-muted">Реферальный код</div>
            <div className="font-mono">{data.user.referralCode}</div>
          </div>
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
            <button onClick={save} className="btn w-full">
              Сохранить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
