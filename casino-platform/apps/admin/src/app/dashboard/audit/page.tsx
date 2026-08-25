'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Loading, PageTitle, Pager, Select, Td, Th } from '@/components/ui'
import { apiGetFull } from '@/lib/api'

interface AuditRow { id: string; createdAt: string; actorType: string; actorId: string; action: string; targetType: string | null; targetId: string | null; payload: any; ipAddress: string | null }

export default function AuditPage() {
  const [page, setPage] = useState(1)
  const [actorType, setActorType] = useState('')
  const [action, setAction] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, actorType, action],
    queryFn: () => apiGetFull<AuditRow[]>('/admin/audit-logs', { page, per_page: 30, actor_type: actorType || undefined, action: action || undefined }),
  })

  return (
    <div>
      <PageTitle>Журнал действий</PageTitle>
      <div className="flex gap-3 mb-4">
        <Select className="w-40" value={actorType} onChange={e => { setActorType(e.target.value); setPage(1) }}>
          <option value="">Все акторы</option>
          <option value="admin">admin</option>
          <option value="user">user</option>
          <option value="system">system</option>
        </Select>
        <input className="input w-56" placeholder="Действие (admin.*…)" value={action} onChange={e => { setAction(e.target.value); setPage(1) }} />
      </div>

      {isLoading && <Loading />}
      {data?.data && (
        <>
          <table className="w-full text-sm">
            <thead><tr><Th>Время</Th><Th>Актор</Th><Th>Действие</Th><Th>Цель</Th><Th>IP</Th><Th>Payload</Th></tr></thead>
            <tbody>
              {data.data.map((a) => (
                <tr key={a.id}>
                  <Td className="text-[#8b8ba7] whitespace-nowrap">{new Date(a.createdAt).toLocaleString('ru-RU')}</Td>
                  <Td>{a.actorType}<div className="text-xs text-[#8b8ba7] font-mono">{a.actorId.slice(0, 8)}</div></Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="text-[#8b8ba7] text-xs">{a.targetType ?? '—'}<div className="font-mono">{a.targetId?.slice(0, 8) ?? ''}</div></Td>
                  <Td className="text-[#8b8ba7] text-xs font-mono">{a.ipAddress ?? '—'}</Td>
                  <Td>
                    {a.payload ? (
                      <details><summary className="cursor-pointer text-xs text-[#60a5fa]">детали</summary>
                        <pre className="mt-1 max-w-sm overflow-x-auto text-[10px] text-[#8b8ba7]">{JSON.stringify(a.payload, null, 1)}</pre>
                      </details>
                    ) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} perPage={30} total={data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  )
}
