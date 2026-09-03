'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Btn, ErrorBox, Input, Loading, PageTitle, Select, Td, Th } from '@/components/ui'
import { apiGet, apiPost, errText } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

interface AdminRow {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  role: 'admin' | 'superadmin'
  isActive: boolean
  lastLoginAt: string | null
}

export default function AdminsPage() {
  const qc = useQueryClient()
  const me = useAuthStore((s) => s.admin)
  const [err, setErr] = useState<string>()
  const [ok, setOk] = useState<string>()
  const [form, setForm] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    role: 'admin',
  })

  const isSuper = me?.role === 'superadmin'
  const list = useQuery({
    queryKey: ['admins'],
    queryFn: () => apiGet<AdminRow[]>('/admin/admins'),
    enabled: isSuper,
  })

  const create = useMutation({
    mutationFn: () => apiPost('/admin/admins', form),
    onSuccess: () => {
      setErr(undefined)
      setOk(`Администратор ${form.email} создан`)
      setForm({ email: '', password: '', first_name: '', last_name: '', role: 'admin' })
      void qc.invalidateQueries({ queryKey: ['admins'] })
    },
    onError: (e) => {
      setOk(undefined)
      setErr(errText(e))
    },
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => apiPost(`/admin/admins/${id}/deactivate`),
    onSuccess: () => {
      setErr(undefined)
      void qc.invalidateQueries({ queryKey: ['admins'] })
    },
    onError: (e) => setErr(errText(e)),
  })

  if (!isSuper) {
    return (
      <div>
        <PageTitle>Администраторы</PageTitle>
        <div className="rounded-lg bg-yellow-950/60 border border-yellow-800 px-4 py-3 text-sm text-yellow-300">
          Раздел доступен только superadmin.
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageTitle>Администраторы</PageTitle>
      <ErrorBox msg={err} />
      {ok && (
        <div className="mb-3 rounded-lg bg-emerald-950/60 border border-emerald-800 px-3 py-2 text-sm text-emerald-300">
          {ok}
        </div>
      )}

      {list.isLoading && <Loading />}
      {list.data && (
        <table className="w-full text-sm mb-8">
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Имя</Th>
              <Th>Роль</Th>
              <Th>Статус</Th>
              <Th>Последний вход</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((a) => (
              <tr key={a.id}>
                <Td>{a.email}</Td>
                <Td className="text-[#8b8ba7]">
                  {[a.firstName, a.lastName].filter(Boolean).join(' ') || '—'}
                </Td>
                <Td>
                  <span className="text-xs bg-white/10 rounded px-2 py-0.5">{a.role}</span>
                </Td>
                <Td>
                  <Badge value={a.isActive ? 'active' : 'blocked'} />
                </Td>
                <Td className="text-[#8b8ba7]">
                  {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('ru-RU') : '—'}
                </Td>
                <Td>
                  {a.isActive && a.email !== me.email && (
                    <Btn small variant="danger" onClick={() => deactivate.mutate(a.id)}>
                      Деактивировать
                    </Btn>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="font-semibold mb-3">Создать администратора</h2>
      <form
        className="flex gap-2 flex-wrap items-end max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <Input
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
          className="w-52"
        />
        <Input
          type="password"
          placeholder="Пароль"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
          minLength={8}
          className="w-44"
        />
        <Input
          placeholder="Имя"
          value={form.first_name}
          onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          className="w-32"
        />
        <Input
          placeholder="Фамилия"
          value={form.last_name}
          onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          className="w-36"
        />
        <Select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'superadmin' })}
          className="w-36"
        >
          <option value="admin">admin</option>
          <option value="superadmin">superadmin</option>
        </Select>
        <Btn disabled={create.isPending}>{create.isPending ? 'Создание…' : 'Создать'}</Btn>
      </form>
    </div>
  )
}
