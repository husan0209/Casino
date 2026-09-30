'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  Badge,
  Btn,
  Card,
  ErrorBox,
  Loading,
  PageTitle,
  Pager,
  Select,
  Td,
  Th,
} from '@/components/ui'
import { apiGetFull, apiPost, errText } from '@/lib/api'
import { type AdminAffiliateCommissionDto, type RunDailyResultDto } from '@/types/affiliate'

/**
 * Все начисления программы + ручной прогон суточного расчёта.
 *
 * Ручной прогон — только superadmin (ограничение на бэкенде) и идемпотентен:
 * повторный запуск за тот же период не создаёт дублей, поэтому кнопку можно
 * нажимать безопасно, если cron не сработал.
 */
export default function AffiliateCommissionsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [run, setRun] = useState<RunDailyResultDto | null>(null)
  const perPage = 20

  const list = useQuery({
    queryKey: ['aff-commissions-admin', page, status],
    queryFn: () =>
      apiGetFull<AdminAffiliateCommissionDto[]>('/admin/affiliate/commissions', {
        page,
        per_page: perPage,
        ...(status !== '' ? { status } : {}),
      }),
  })

  const runDaily = useMutation({
    mutationFn: () => apiPost<RunDailyResultDto>('/admin/affiliate/run-daily', {}),
    onSuccess: (result) => {
      setError(undefined)
      setRun(result)
      void queryClient.invalidateQueries({ queryKey: ['aff-commissions-admin'] })
    },
    onError: (err: unknown) => setError(errText(err)),
  })

  return (
    <div>
      <PageTitle>Начисления партнёрам</PageTitle>
      <ErrorBox msg={error} />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Суточный расчёт</div>
            <div className="text-xs text-[#8b8ba7] mt-1">
              Обычно запускается автоматически раз в сутки. Ручной запуск безопасен: операция
              идемпотентна — повторный прогон не создаст дублей начислений.
            </div>
          </div>
          <Btn variant="ok" onClick={() => runDaily.mutate()} disabled={runDaily.isPending}>
            {runDaily.isPending ? 'Считаем…' : 'Запустить за вчера'}
          </Btn>
        </div>
        {run !== null && (
          <div className="mt-3 pt-3 border-t border-white/10 text-sm">
            Период <b className="font-mono">{run.date}</b>: обработано {run.processed}, создано{' '}
            {run.created}, зачислено {run.credited}
            {run.errors.length > 0 && (
              <span className="text-red-400"> · ошибок: {run.errors.length}</span>
            )}
          </div>
        )}
      </Card>

      <div className="mb-4 max-w-[220px]">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
        >
          <option value="">Все статусы</option>
          <option value="pending">Ожидают зачисления</option>
          <option value="approved">Зачислены</option>
          <option value="cancelled">Отменены</option>
        </Select>
      </div>

      {list.isLoading && <Loading />}

      {list.data !== undefined && (
        <>
          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Период</Th>
                  <Th>Партнёр</Th>
                  <Th>Игрок</Th>
                  <Th>NGR</Th>
                  <Th>Ставка</Th>
                  <Th>Комиссия</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((row) => (
                  <tr key={row.id}>
                    <Td className="whitespace-nowrap">{row.period_start}</Td>
                    <Td>
                      <a
                        href={`/dashboard/affiliate/partners/${row.affiliate_id}`}
                        className="text-[#ff3b7a] hover:underline font-mono text-xs"
                      >
                        {row.affiliate_id.slice(0, 8)}
                      </a>
                    </Td>
                    <Td className="font-mono text-xs text-[#8b8ba7]">
                      {row.player_id.slice(0, 8)}
                    </Td>
                    <Td className="font-mono">
                      {Number(row.ngr_amount).toLocaleString('ru-RU', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      <span className="text-[#8b8ba7] text-xs">{row.currency}</span>
                    </Td>
                    <Td className="font-mono text-[#8b8ba7]">
                      {(Number(row.revshare_rate) * 100).toFixed(1)}%
                    </Td>
                    <Td className="font-mono font-semibold text-emerald-400">
                      {Number(row.commission_amount).toLocaleString('ru-RU', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Td>
                    <Td>
                      <Badge value={row.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data.data.length === 0 && (
              <div className="text-[#8b8ba7] text-sm py-4">Начислений пока нет</div>
            )}
          </Card>
          <Pager
            page={page}
            perPage={perPage}
            total={list.data.meta?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}
    </div>
  )
}
