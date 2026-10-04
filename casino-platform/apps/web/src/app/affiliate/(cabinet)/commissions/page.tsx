'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { affiliateGet } from '@/lib/affiliate-api'
import { formatAmount, formatRate, statusLabel, statusToneClass } from '@/lib/affiliate-format'
import { type AffiliateCommissionDto, type AffiliateListDto } from '@/types/affiliate'

/**
 * Начисления с полной разбивкой NGR.
 *
 * Почему разбивка обязательна: партнёр, получающий 20% от NGR, обязан видеть,
 * из чего сложилась сумма. Показывать только итог — значит просить довериться
 * без возможности проверить; в гемблинг-партнёрках это главная причина ухода
 * (ТЗ ч.8 §3.9). Поэтому каждая строка раскрывает bet/win/rollback/bonus/fee.
 */
export default function AffiliateCommissionsPage(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const perPage = 20

  const { data, isLoading } = useQuery({
    queryKey: ['aff-commissions', page],
    queryFn: () =>
      affiliateGet<AffiliateListDto<AffiliateCommissionDto>>('/affiliate/commissions', {
        page,
        per_page: perPage,
      }),
  })

  const total = data?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / perPage))

  return (
    <div>
      <div className="card mb-4">
        <div className="font-semibold mb-1">Как читать разбивку</div>
        <div className="text-muted text-sm">
          <b>Ставки</b> − <b>Выигрыши</b> − <b>Отмены</b> = <b>GGR</b>; далее GGR − <b>Бонусы</b> −{' '}
          <b>Комиссия провайдера</b> = <b>NGR</b>. Ваша комиссия = NGR × ставка. Отрицательный NGR
          даёт нулевую комиссию — строки с нулевым итогом не создаются.
        </div>
      </div>

      {isLoading && <div className="text-muted text-sm py-6">Загрузка…</div>}

      {data?.data.length === 0 && (
        <div className="card text-muted text-sm">
          Начислений пока нет. Они появляются после того, как приведённые игроки начнут играть.
        </div>
      )}

      {data !== undefined && data.data.length > 0 && (
        <>
          {/* Десктоп: таблица. Мобильный: карточки — колонок слишком много. */}
          <div className="hidden md:block card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {[
                    'Период',
                    'Валюта',
                    'Ставки',
                    'Выигрыши',
                    'Бонусы',
                    'NGR',
                    'Ставка',
                    'Комиссия',
                    'Статус',
                  ].map((title) => (
                    <th
                      key={title}
                      className="text-left text-[11px] uppercase tracking-wide text-[#8888AA] px-3 py-2.5 whitespace-nowrap"
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => {
                  const status = statusLabel(row.status)
                  return (
                    <tr key={row.id} className="border-b border-white/5 last:border-0">
                      <td className="px-3 py-2.5 whitespace-nowrap">{row.period_start}</td>
                      <td className="px-3 py-2.5 text-[#8888AA]">{row.currency}</td>
                      <td className="px-3 py-2.5 font-mono text-right">
                        {formatAmount(row.bet_sum, row.currency)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-right">
                        {formatAmount(row.win_sum, row.currency)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-right text-[#8888AA]">
                        {formatAmount(row.bonus_sum, row.currency)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-right">
                        {formatAmount(row.ngr_amount, row.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[#8888AA]">
                        {formatRate(row.revshare_rate)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-right font-bold text-money-dark">
                        {formatAmount(row.commission_amount, row.currency)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-xs ${statusToneClass(status.tone)}`}
                        >
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Мобильная раскладка */}
          <div className="md:hidden space-y-3">
            {data.data.map((row) => {
              const status = statusLabel(row.status)
              return (
                <div key={row.id} className="card">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-muted text-sm">{row.period_start}</span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs ${statusToneClass(status.tone)}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <div className="text-lg font-black text-money-dark mb-2">
                    +{formatAmount(row.commission_amount, row.currency)} {row.currency}
                  </div>
                  <div className="text-xs text-[#8888AA] space-y-0.5">
                    <div className="flex justify-between">
                      <span>Ставки</span>
                      <span className="font-mono">{formatAmount(row.bet_sum, row.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Выигрыши</span>
                      <span className="font-mono">−{formatAmount(row.win_sum, row.currency)}</span>
                    </div>
                    {Number(row.bonus_sum) > 0 && (
                      <div className="flex justify-between">
                        <span>Бонусы</span>
                        <span className="font-mono">
                          −{formatAmount(row.bonus_sum, row.currency)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-white/10 pt-0.5 mt-1">
                      <span>NGR</span>
                      <span className="font-mono">
                        {formatAmount(row.ngr_amount, row.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>× {formatRate(row.revshare_rate)}</span>
                      <span className="font-mono">
                        {formatAmount(row.commission_amount, row.currency)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-3 mt-3 text-sm text-muted">
            <button
              className="btn-ghost text-sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ← Назад
            </button>
            <span>
              {page} / {pages} · всего {total}
            </span>
            <button
              className="btn-ghost text-sm"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Вперёд →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
