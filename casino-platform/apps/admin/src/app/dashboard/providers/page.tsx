'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Btn, ErrorBox, Loading, PageTitle, Td, Th } from '@/components/ui'
import { apiGet, apiPost, errText } from '@/lib/api'

interface ProviderRow {
  id: string
  slug: string
  name: string
  type: string
  isEnabled: boolean
  gameCount: number
}
interface SyncResult {
  added: number
  updated: number
  total: number
  note: string
}

export default function ProvidersPage(): React.JSX.Element {
  const qc = useQueryClient()
  const [err, setErr] = useState<string>()
  const [note, setNote] = useState<string>()

  const { data, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiGet<ProviderRow[]>('/admin/providers'),
  })

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiPost<SyncResult>(`/admin/providers/${id}/${action}`),
    onSuccess: (res, vars) => {
      setErr(undefined)
      void qc.invalidateQueries({ queryKey: ['providers'] })
      if (vars.action === 'sync-games') {
        setNote(res.note)
      }
    },
    onError: (e) => setErr(errText(e)),
  })

  return (
    <div>
      <PageTitle>Провайдеры</PageTitle>
      <ErrorBox msg={err} />
      {note && (
        <div className="mb-3 rounded-lg bg-blue-950/60 border border-blue-800 px-3 py-2 text-sm text-blue-300">
          {note}
        </div>
      )}
      {isLoading && <Loading />}
      {data && (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Название</Th>
              <Th>Slug</Th>
              <Th>Тип</Th>
              <Th>Игр</Th>
              <Th>Статус</Th>
              <Th>Действия</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <Td>{p.name}</Td>
                <Td className="font-mono text-xs text-[#8b8ba7]">{p.slug}</Td>
                <Td>
                  <Badge value={p.type} />
                </Td>
                <Td className="font-mono">{p.gameCount}</Td>
                <Td>
                  <Badge value={p.isEnabled ? 'active' : 'cancelled'} />
                </Td>
                <Td>
                  <div className="flex gap-1 flex-wrap">
                    <Btn
                      small
                      variant={p.isEnabled ? 'ghost' : 'ok'}
                      onClick={() =>
                        act.mutate({ id: p.id, action: p.isEnabled ? 'disable' : 'enable' })
                      }
                    >
                      {p.isEnabled ? 'Выключить' : 'Включить'}
                    </Btn>
                    <Btn
                      small
                      variant="ghost"
                      onClick={() => act.mutate({ id: p.id, action: 'sync-games' })}
                    >
                      🔄 Синхронизировать
                    </Btn>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
