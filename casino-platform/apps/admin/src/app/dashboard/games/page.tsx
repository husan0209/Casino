'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Btn, ErrorBox, Loading, PageTitle, Pager, Select, Td, Th } from '@/components/ui'
import { apiGetFull, apiPatch, apiPost, errText } from '@/lib/api'

interface GameRow {
  id: string
  name: string
  slug: string
  isEnabled: boolean
  isFeatured: boolean
  isPopular: boolean
  rtp: string | null
  rtpDemo: string | null
  launchCount: number
  category: string
  provider?: { name: string }
}

/**
 * Регулировка возврата: цель в процентах, сервер по ней собирает комплект
 * таблиц множителей. Факт может отличаться на сотые — такова цена
 * отображаемого множителя (шаг 0,01), а не скрытая надбавка.
 */
function RtpCell({
  game,
  onError,
}: {
  game: GameRow
  onError: (message: string) => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [money, setMoney] = useState(game.rtp ?? '')
  const [demo, setDemo] = useState(game.rtpDemo ?? '')
  const dirty = money !== (game.rtp ?? '') || demo !== (game.rtpDemo ?? '')

  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/admin/games/${game.id}`, {
        rtp: money === '' ? null : Number(money),
        rtp_demo: demo === '' ? null : Number(demo),
      }),
    onSuccess: () => {
      onError('')
      void qc.invalidateQueries({ queryKey: ['games'] })
    },
    onError: (e) => onError(errText(e)),
  })

  const box = 'w-16 bg-[#14142a] border border-[#2A2A4A] rounded px-2 py-1 text-xs font-mono'
  return (
    <Td>
      <div className="flex items-center gap-1">
        <input
          className={box}
          aria-label={`Возврат на деньги, ${game.name}`}
          type="number"
          step="0.1"
          min="1"
          max="500"
          value={money}
          onChange={(e) => setMoney(e.target.value)}
          placeholder="—"
        />
        <input
          className={box}
          aria-label={`Возврат демо, ${game.name}`}
          type="number"
          step="0.1"
          min="1"
          max="500"
          value={demo}
          onChange={(e) => setDemo(e.target.value)}
          placeholder="—"
        />
        <Btn small variant="ok" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? '…' : 'OK'}
        </Btn>
      </div>
      <div className="text-[10px] text-[#8b8ba7] mt-0.5">деньги / демо</div>
    </Td>
  )
}

export default function GamesPage(): React.JSX.Element {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [enabled, setEnabled] = useState('')
  const [err, setErr] = useState<string>()

  const { data, isLoading } = useQuery({
    queryKey: ['games', page, search, enabled],
    queryFn: () =>
      apiGetFull<GameRow[]>('/admin/games', {
        page,
        per_page: 30,
        search: search || undefined,
        is_enabled: enabled === '' ? undefined : enabled,
      }),
  })

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiPost(`/admin/games/${id}/${action}`),
    onSuccess: () => {
      setErr(undefined)
      void qc.invalidateQueries({ queryKey: ['games'] })
    },
    onError: (e) => setErr(errText(e)),
  })

  return (
    <div>
      <PageTitle>Игры</PageTitle>
      <ErrorBox msg={err} />
      <div className="flex gap-3 mb-4">
        <input
          className="input w-64"
          placeholder="Поиск по названию…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        <Select
          className="w-40"
          value={enabled}
          onChange={(e) => {
            setEnabled(e.target.value)
            setPage(1)
          }}
        >
          <option value="">Вкл/выкл: все</option>
          <option value="true">Включённые</option>
          <option value="false">Выключенные</option>
        </Select>
      </div>

      {isLoading && <Loading />}
      {data?.data && (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Игра</Th>
                <Th>Провайдер</Th>
                <Th>Категория</Th>
                <Th>Возврат, %</Th>
                <Th>Запусков</Th>
                <Th>Флаги</Th>
                <Th>Действия</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((g) => (
                <tr key={g.id}>
                  <Td>
                    {g.name}
                    <div className="text-xs text-[#8b8ba7]">{g.slug}</div>
                  </Td>
                  <Td className="text-[#8b8ba7]">{g.provider?.name ?? '—'}</Td>
                  <Td>
                    <Badge value={g.category} />
                  </Td>
                  <RtpCell game={g} onError={setErr} />
                  <Td className="font-mono">{g.launchCount}</Td>
                  <Td className="space-x-1">
                    <Badge value={g.isEnabled ? 'active' : 'cancelled'} />
                    {g.isFeatured && <span className="text-yellow-300">★</span>}
                  </Td>
                  <Td>
                    <div className="flex gap-1 flex-wrap">
                      <Btn
                        small
                        variant={g.isEnabled ? 'ghost' : 'ok'}
                        onClick={() =>
                          act.mutate({ id: g.id, action: g.isEnabled ? 'disable' : 'enable' })
                        }
                      >
                        {g.isEnabled ? 'Выключить' : 'Включить'}
                      </Btn>
                      <Btn
                        small
                        variant="ghost"
                        onClick={() =>
                          act.mutate({ id: g.id, action: g.isFeatured ? 'unfeature' : 'feature' })
                        }
                      >
                        {g.isFeatured ? 'Убрать ★' : '★ Featured'}
                      </Btn>
                    </div>
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
