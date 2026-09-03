'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

import { Card, Loading, PageTitle } from '@/components/ui'
import { apiGet } from '@/lib/api'

interface Metrics {
  period: string
  users: { total: number; new_in_period: number; active_today: number }
  finance: {
    deposits: string
    withdrawals: string
    ggr: string
    deposits_total: string
    withdrawals_total: string
  }
  pending: { withdrawals: number; kyc: number; tickets: number }
}
type Period = 'today' | '7d' | '30d' | '90d'

const fmt = (v: string | number): string =>
  typeof v === 'number' ? v.toLocaleString('ru-RU') : `${Number(v).toLocaleString('ru-RU')} ₽`

export default function DashboardPage(): React.JSX.Element {
  const [period, setPeriod] = useState<Period>('today')
  const [chartDays, setChartDays] = useState<Exclude<Period, 'today'>>('7d')

  const metrics = useQuery({
    queryKey: ['dash', 'metrics', period],
    queryFn: () => apiGet<Metrics>('/admin/dashboard/metrics', { period }),
    refetchInterval: 30000,
  })
  const revenue = useQuery({
    queryKey: ['dash', 'revenue', chartDays],
    queryFn: () =>
      apiGet<{ labels: string[]; datasets: Record<string, string[]> }>('/admin/dashboard/charts', {
        period: chartDays,
        type: 'revenue',
      }),
  })
  const regs = useQuery({
    queryKey: ['dash', 'regs', chartDays],
    queryFn: () =>
      apiGet<{ labels: string[]; datasets: { registrations: number[] } }>(
        '/admin/dashboard/charts',
        { period: chartDays, type: 'registrations' },
      ),
  })
  const events = useQuery({
    queryKey: ['dash', 'events'],
    queryFn: () =>
      apiGet<Array<{ at: string; type: string; detail: string }>>('/admin/dashboard/events', {
        limit: 10,
      }),
  })

  const cards: Array<[string, string, string]> = metrics.data
    ? [
        [
          'Пользователи',
          fmt(metrics.data!.users.total),
          `+${metrics.data.users.new_in_period} за период · активных сегодня ${metrics.data.users.active_today}`,
        ],
        [
          'Депозиты',
          fmt(metrics.data!.finance['deposits']),
          `всего ${fmt(metrics.data!.finance['deposits_total'])}`,
        ],
        [
          'Выводы',
          fmt(metrics.data!.finance['withdrawals']),
          `всего ${fmt(metrics.data!.finance['withdrawals_total'])}`,
        ],
        ['GGR', fmt(metrics.data!.finance['ggr']), `за период (${period})`],
      ]
    : []

  const rd = revenue.data
  const revData = rd
    ? rd.labels.map((l, i) => ({
        day: l.slice(5),
        deposits: Number(rd.datasets.deposits?.[i] ?? 0),
        withdrawals: Number(rd.datasets.withdrawals?.[i] ?? 0),
        ggr: Number(rd.datasets.ggr?.[i] ?? 0),
      }))
    : []
  const rg = regs.data
  const regData = rg
    ? rg.labels.map((l, i) => ({ day: l.slice(5), count: rg.datasets.registrations[i] ?? 0 }))
    : []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageTitle>Дашборд</PageTitle>
        <select
          className="input"
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
        >
          <option value="today">Сегодня</option>
          <option value="7d">7 дней</option>
          <option value="30d">30 дней</option>
          <option value="90d">90 дней</option>
        </select>
      </div>

      {!metrics.data && <Loading />}
      {metrics.data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {cards.map(([t, v, d]) => (
            <Card key={t}>
              <div className="text-sm text-[#8b8ba7]">{t}</div>
              <div className="text-2xl font-bold mt-1">{v}</div>
              <div className="text-xs text-[#8b8ba7] mt-1">{d}</div>
            </Card>
          ))}
        </div>
      )}

      {metrics.data && (
        <div className="flex gap-3 mb-8 text-sm">
          <Link
            href="/dashboard/withdrawals?status=pending"
            className="bg-[#141420] border border-white/10 rounded-xl px-4 py-2 hover:bg-white/5"
          >
            ⏳ Выводы на модерации:{' '}
            <b className="text-yellow-300">{metrics.data.pending.withdrawals}</b>
          </Link>
          <Link
            href="/dashboard/kyc?status=pending"
            className="bg-[#141420] border border-white/10 rounded-xl px-4 py-2 hover:bg-white/5"
          >
            🪪 KYC на проверке: <b className="text-yellow-300">{metrics.data.pending.kyc}</b>
          </Link>
          <Link
            href="/dashboard/support?status=open"
            className="bg-[#141420] border border-white/10 rounded-xl px-4 py-2 hover:bg-white/5"
          >
            🎫 Открытые тикеты: <b className="text-sky-300">{metrics.data.pending.tickets}</b>
          </Link>
        </div>
      )}

      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold">Графики</h2>
        {[
          ['7d', '7 дней'],
          ['30d', '30 дней'],
          ['90d', '90 дней'],
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setChartDays(v as Exclude<Period, 'today'>)}
            className={`rounded-lg px-3 py-1 text-xs ${chartDays === v ? 'bg-[#ff3b7a]' : 'bg-white/5 hover:bg-white/10'}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <Card>
          <div className="text-sm text-[#8b8ba7] mb-3">Доход (RUB)</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={revData}>
              <XAxis dataKey="day" stroke="#555" fontSize={11} />
              <YAxis stroke="#555" fontSize={11} width={70} />
              <Tooltip contentStyle={{ background: '#141420', border: '1px solid #333' }} />
              <Legend />
              <Line
                type="monotone"
                dataKey="deposits"
                name="Депозиты"
                stroke="#34d399"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="withdrawals"
                name="Выводы"
                stroke="#f87171"
                dot={false}
              />
              <Line type="monotone" dataKey="ggr" name="GGR" stroke="#60a5fa" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <div className="text-sm text-[#8b8ba7] mb-3">Регистрации</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={regData}>
              <XAxis dataKey="day" stroke="#555" fontSize={11} />
              <YAxis stroke="#555" fontSize={11} width={40} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#141420', border: '1px solid #333' }} />
              <Bar dataKey="count" name="Регистрации" fill="#ff3b7a" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <h2 className="font-semibold mb-3">Последние события</h2>
      <Card>
        {events.data?.length ? (
          <table className="w-full text-sm">
            <tbody>
              {events.data.map((e, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="px-2 py-1.5 text-[#8b8ba7] whitespace-nowrap">
                    {new Date(e.at).toLocaleTimeString('ru-RU')}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="text-xs bg-white/10 rounded px-1.5 py-0.5">{e.type}</span>
                  </td>
                  <td className="px-2 py-1.5">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Loading />
        )}
      </Card>
    </div>
  )
}
