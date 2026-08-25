'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Btn, ErrorBox, Input, Loading, PageTitle, Pager, Select, Td, Th } from '@/components/ui'
import { apiGetFull, apiPost, errText } from '@/lib/api'

interface UserRow { id: string; email: string | null; status: string; createdAt: string; lastLoginAt: string | null; referralCode: string }

export default function UsersPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [err, setErr] = useState<string>()

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, search, status],
    queryFn: () => apiGetFull<UserRow[]>('/admin/users', { page, per_page: 20, search: search || undefined, status: status || undefined }),
    refetchInterval: 15000,
  })

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'block' | 'unblock' }) => apiPost(`/admin/users/${id}/${action}`, { reason: 'admin panel' }),
    onSuccess: () => { setErr(undefined); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (e) => setErr(errText(e)),
  })

  return (
    <div>
      <PageTitle>Пользователи</PageTitle>
      <ErrorBox msg={err} />
      <div className="flex gap-3 mb-4">
        <Input placeholder="Поиск email/username…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="w-64" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-40">
          <option value="">Все статусы</option>
          <option value="active">active</option>
          <option value="blocked">blocked</option>
          <option value="suspended">suspended</option>
        </Select>
      </div>

      {isLoading && <Loading />}
      {data?.data && (
        <>
          <table className="w-full text-sm">
            <thead><tr><Th>ID</Th><Th>Email</Th><Th>Статус</Th><Th>Рег.</Th><Th>Последний вход</Th><Th>Действия</Th></tr></thead>
            <tbody>
              {data.data.map((u) => (
                <tr key={u.id}>
                  <Td className="text-[#8b8ba7] font-mono text-xs">{u.id.slice(0, 8)}</Td>
                  <Td>{u.email}</Td>
                  <Td><Badge value={u.status} /></Td>
                  <Td className="text-[#8b8ba7]">{new Date(u.createdAt).toLocaleDateString('ru-RU')}</Td>
                  <Td className="text-[#8b8ba7]">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ru-RU') : '—'}</Td>
                  <Td>
                    {u.status === 'blocked'
                      ? <Btn small variant="ok" onClick={() => act.mutate({ id: u.id, action: 'unblock' })}>Разблокировать</Btn>
                      : <Btn small variant="danger" onClick={() => act.mutate({ id: u.id, action: 'block' })}>Блокировать</Btn>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} perPage={20} total={data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  )
}
