'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { apiGet, apiPost, errText } from '@/lib/api'
import { Btn, ErrorBox, Input, Loading, PageTitle, Td } from '@/components/ui'

interface SettingRow { id: string; key: string; value: string; type: string; description: string | null; updatedAt: string }

export default function SettingsPage() {
  const qc = useQueryClient()
  const me = useAuthStore((s) => s.admin)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string>()
  const [okMsg, setOkMsg] = useState<string>()

  const isSuper = me?.role === 'superadmin'
  const list = useQuery({ queryKey: ['settings'], queryFn: () => apiGet<SettingRow[]>('/admin/settings') })

  const save = useMutation({
    mutationFn: (row: SettingRow) => apiPost('/admin/settings', { key: row.key, value: drafts[row.key] ?? row.value, type: row.type }),
    onSuccess: () => { setErr(undefined); setOkMsg('Сохранено'); qc.invalidateQueries({ queryKey: ['settings'] }) },
    onError: (e) => { setOkMsg(undefined); setErr(errText(e)) },
  })

  return (
    <div>
      <PageTitle>Глобальные настройки</PageTitle>
      <ErrorBox msg={err} />
      {okMsg && <div className="mb-3 rounded-lg bg-emerald-950/60 border border-emerald-800 px-3 py-2 text-sm text-emerald-300">{okMsg}</div>}
      {!isSuper && <div className="mb-4 text-sm text-yellow-300">Изменение доступно только superadmin.</div>}

      {list.isLoading && <Loading />}
      {list.data && list.data.length === 0 && <div className="text-sm text-[#8b8ba7]">Настройки пока не заданы (таблица system_settings пуста).</div>}
      {list.data && list.data.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[#8b8ba7] border-b border-white/10">
              <th className="px-3 py-2">Ключ</th><th className="px-3 py-2">Значение</th><th className="px-3 py-2">Описание</th><th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((row) => (
              <tr key={row.id}>
                <Td className="font-mono text-xs">{row.key}</Td>
                <Td>
                  <Input
                    value={drafts[row.key] ?? row.value}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                    disabled={!isSuper}
                    className="w-64"
                  />
                </Td>
                <Td className="text-[#8b8ba7] max-w-sm">{row.description ?? '—'}</Td>
                <Td>
                  {isSuper && drafts[row.key] !== undefined && drafts[row.key] !== row.value && (
                    <Btn small onClick={() => save.mutate(row)} disabled={save.isPending}>Сохранить</Btn>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
