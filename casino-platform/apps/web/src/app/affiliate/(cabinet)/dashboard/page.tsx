'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { affiliateGet } from '@/lib/affiliate-api'
import { formatAmount, formatRate } from '@/lib/affiliate-format'
import { type AffiliateDashboardDto, type AffiliateMeDto } from '@/types/affiliate'

/** Плитка KPI. Тон задаётся явно, чтобы доход читался сразу, а не сканировался. */
function Kpi({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'money'
}): React.JSX.Element {
  return (
    <div className="card">
      <div className="text-muted text-sm">{label}</div>
      <div
        className={
          tone === 'money' ? 'text-2xl font-black mt-1 text-[#00C853]' : 'text-2xl font-black mt-1'
        }
      >
        {value}
      </div>
      {hint !== undefined && <div className="text-muted text-xs mt-1">{hint}</div>}
    </div>
  )
}

export default function AffiliateDashboardPage(): React.JSX.Element {
  const me = useQuery({
    queryKey: ['aff-me'],
    queryFn: () => affiliateGet<AffiliateMeDto>('/affiliate/me'),
  })
  const dashboard = useQuery({
    queryKey: ['aff-dashboard', 30],
    queryFn: () => affiliateGet<AffiliateDashboardDto>('/affiliate/dashboard', { days: 30 }),
  })

  const data = dashboard.data
  const suspended = me.data?.status !== 'active'

  return (
    <div>
      {suspended && (
        <div className="card mb-4 border-[#FFB300]/40">
          <div className="text-[#FFB300] font-semibold text-sm">Аккаунт приостановлен</div>
          <div className="text-muted text-sm mt-1">
            Клики по вашей ссылке не атрибутируются, новые игроки не привязываются. Начисления за
            уже закрытые периоды сохраняются. Обратитесь в поддержку, чтобы восстановить работу.
          </div>
        </div>
      )}

      {/* Ставка — первое, что партнёр хочет проверить. Показываем крупно. */}
      <div className="card mb-4 border-brand/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-muted text-sm">Ваша ставка RevShare</div>
            <div className="text-3xl font-black text-[#00C853] mt-0.5">
              {me.data ? formatRate(me.data.revshare_rate) : '…'}
            </div>
            <div className="text-muted text-xs mt-1">
              начисляется с чистого игрового дохода (NGR) ваших игроков
            </div>
          </div>
          <Link href="/affiliate/links" className="btn shrink-0">
            Получить ссылку
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi
          label="Заработано всего"
          value={me.data ? formatAmount(me.data.total_earned, me.data.payout_currency) : '…'}
          hint="включая текущий баланс"
          tone="money"
        />
        <Kpi
          label="Баланс кошелька"
          value={me.data ? formatAmount(me.data.balance.RUB, 'RUB') : '…'}
          hint="вывод через кассу казино"
          tone="money"
        />
        <Kpi
          label="За 30 дней"
          value={data ? formatAmount(data.totals.total_commission, 'RUB') : '…'}
          hint="комиссия"
          tone="money"
        />
        <Kpi
          label="NGR за 30 дней"
          value={data ? formatAmount(data.totals.total_ngr, 'RUB') : '…'}
          hint="база начислений"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi
          label="Клики (30 дней)"
          value={data ? String(data.clicks.total) : '…'}
          hint={data ? `конверсия ${data.clicks.conversion_rate}%` : 'загрузка'}
        />
        <Kpi
          label="Приведено игроков"
          value={data ? String(data.players.total) : '…'}
          hint="всего за время работы"
        />
        <Kpi
          label="GGR за 30 дней"
          value={data ? formatAmount(data.totals.total_ggr, 'RUB') : '…'}
          hint="ставки минус выигрыши"
        />
        <Kpi
          label="Cookie-окно"
          value={data ? `${data.settings.cookie_days} дн.` : '…'}
          hint="атрибуция с клика"
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold">Как формируется ваш доход</div>
        </div>
        <div className="text-muted text-sm">
          NGR = ставки − выигрыши − отмены − бонусы игроков. Комиссия = NGR ×{' '}
          {me.data ? formatRate(me.data.revshare_rate) : 'ставка'}. Периоды с отрицательным NGR не
          приносят комиссии — вы не платите за убыточных игроков. Полная разбивка по каждому периоду
          — в разделе «Начисления».
        </div>
        <div className="mt-3 pt-3 border-t border-white/10 text-muted text-xs">
          Начисления считаются ежедневно за предыдущие сутки. Проверьте полную формулу расчёта на
          публичной странице{' '}
          <Link href="/affiliate" className="text-brand underline">
            программы
          </Link>
          .
        </div>
      </div>
    </div>
  )
}
