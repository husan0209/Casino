'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge, Card, Loading, PageTitle, Pager, Select, Td, Th } from '@/components/ui'
import { apiGetFull } from '@/lib/api'
import { type AdminAffiliateAttributionDto } from '@/types/affiliate'

/** Человеческие названия причин отказа — админ должен понимать, что произошло. */
const REASON_LABELS: Record<string, string> = {
  self_referral: 'Самопривлечение (IP/UA совпал с партнёром)',
  self_exclusion: 'Игрок самоисключился — clawback',
  fraud: 'Подтверждённый фрод',
  chargeback: 'Чарджбэк по депозиту',
  kyc_fail: 'Не пройден KYC',
  dormancy: 'Нет активности',
  ip_flood: 'Флуд трафика с одного IP',
  near_threshold_deposit: 'Депозит ровно на порог допуска',
  manual: 'Отказ администратора',
}

/**
 * Атрибуции — точка входа для разбора спорных случаев.
 *
 * Здесь видно, СКОЛЬКО трафика ушло в отказ и по какой причине. Рост доли
 * `self_referral` или `ip_flood` по конкретному партнёру — главный индикатор
 * накрутки; поэтому колонка «причина» не скрыта за раскрытием строки.
 */
export default function AffiliateAttributionsPage(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const perPage = 20

  const list = useQuery({
    queryKey: ['aff-attributions', page, status],
    queryFn: () =>
      apiGetFull<AdminAffiliateAttributionDto[]>('/admin/affiliate/attributions', {
        page,
        per_page: perPage,
        ...(status !== '' ? { status } : {}),
      }),
  })

  return (
    <div>
      <PageTitle>Атрибуции игроков</PageTitle>

      <div className="mb-4 max-w-[220px]">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
        >
          <option value="">Все статусы</option>
          <option value="pending">Ожидают</option>
          <option value="qualified">Квалифицированы</option>
          <option value="rejected">Отклонены</option>
        </Select>
      </div>

      {list.isLoading && <Loading />}

      {list.data !== undefined && (
        <>
          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Партнёр</Th>
                  <Th>Игрок</Th>
                  <Th>Статус</Th>
                  <Th>Депозит</Th>
                  <Th>Самопривлечение</Th>
                  <Th>Причина</Th>
                  <Th>Создана</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((row) => (
                  <tr key={row.id}>
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
                    <Td>
                      <Badge value={row.status} />
                    </Td>
                    <Td className="font-mono">
                      {Number(row.total_deposit).toLocaleString('ru-RU', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Td>
                    <Td>{row.is_self_referral ? '⚠ да' : '—'}</Td>
                    <Td className="text-xs">
                      {row.reject_reason !== null
                        ? (REASON_LABELS[row.reject_reason] ?? row.reject_reason)
                        : '—'}
                    </Td>
                    <Td className="text-[#8b8ba7] text-xs">{row.created_at.slice(0, 10)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data.data.length === 0 && (
              <div className="text-[#8b8ba7] text-sm py-4">Атрибуций пока нет</div>
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

      <Card className="mt-4">
        <div className="font-semibold mb-1">Как читать причины</div>
        <div className="text-xs text-[#8b8ba7] space-y-1">
          <div>
            <b>self_referral</b> — IP или User-Agent игрока совпал с последним кликом партнёра.
            Партнёр привёл сам себя с одного устройства.
          </div>
          <div>
            <b>ip_flood</b> — с одного IP за сутки пришло больше игроков, чем порог настройки.
            Признак накрутки.
          </div>
          <div>
            <b>self_exclusion</b> — игрок включил самоисключение. Начисления по нему отменены,
            деньги списаны с кошелька партнёра (если средств хватило).
          </div>
        </div>
      </Card>
    </div>
  )
}
