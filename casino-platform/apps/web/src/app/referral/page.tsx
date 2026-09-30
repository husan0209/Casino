'use client'
import { useQuery } from '@tanstack/react-query'

import { toast } from '@/components/ui/toaster'
import { apiGet } from '@/lib/api'
import { formatAmount } from '@/lib/format/currency'
import { useAuth } from '@/stores/auth'
import type { ReferralInfoDto, ReferralRewardsDto } from '@/types/referral'

/** Статусы начислений (enum ReferralRewardStatus) — по-русски, без сырого кода API. */
const REWARD_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'ожидает', cls: 'text-[#FFB300]' },
  credited: { label: 'зачислено', cls: 'text-[#00C853]' },
  zero: { label: 'без начисления', cls: 'text-muted' },
}

export default function ReferralPage(): React.JSX.Element {
  const { user } = useAuth()
  const { data: info } = useQuery({
    queryKey: ['ref-info'],
    queryFn: () => apiGet<ReferralInfoDto>('/referrals/info'),
    enabled: Boolean(user),
  })
  const { data: rewards } = useQuery({
    queryKey: ['ref-rewards'],
    queryFn: () => apiGet<ReferralRewardsDto>('/referrals/rewards'),
    enabled: Boolean(user),
  })
  if (!user) {
    return <div className="container-1 py-6">Войдите, чтобы получить реферальную ссылку</div>
  }
  const rewardRows = (rewards?.data ?? []).slice(0, 20)
  return (
    <div className="container-1 py-6 max-w-3xl">
      <p className="caps-label">ПАРТНЁРКА</p>
      <h1 className="page-title mb-6">Реферальная программа</h1>
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="card">
          <div className="text-sm text-muted">Рефералы</div>
          <div className="text-2xl font-bold">{info?.total_referrals ?? 0}</div>
        </div>
        <div className="card">
          <div className="text-sm text-muted">Заработано</div>
          <div className="text-2xl font-bold text-[#00C853]">
            {formatAmount(info?.total_earned.RUB ?? '0', 'RUB')}
          </div>
        </div>
        <div className="card">
          <div className="text-sm text-muted">Ставка</div>
          <div className="text-2xl font-bold">{info?.reward_rate || '5%'}</div>
        </div>
      </div>
      <div className="card mb-6">
        <div className="text-sm text-muted">Ваша ссылка</div>
        <div className="mt-1 flex gap-2">
          <input readOnly value={info?.referral_link || ''} className="input" />
          <button
            onClick={() => {
              void navigator.clipboard.writeText(info?.referral_link || '')
              toast.success('Скопировано')
            }}
            className="btn-ghost shrink-0 text-sm"
          >
            Копировать
          </button>
        </div>
        <div className="mt-2 text-xs text-muted">
          Код: <b>{info?.referral_code}</b> • бонус с игры друзей ежедневно
        </div>
      </div>
      <div className="card">
        <div className="mb-2 font-semibold">Последние начисления</div>
        {rewardRows.length === 0 ? (
          <div className="py-4 text-sm text-muted">Начислений пока нет</div>
        ) : (
          <ul className="divide-y divide-[#2A2A4A]">
            {rewardRows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm">
                    {new Date(r.periodStart).toLocaleDateString('ru')}
                  </div>
                  <div className="text-xs text-muted">
                    Оборот друга {formatAmount(r.ggrAmount, r.currency)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold text-[#00C853]">
                    {formatAmount(r.rewardAmount, r.currency)}
                  </div>
                  <div className={`text-xs ${REWARD_STATUS[r.status]?.cls ?? 'text-muted'}`}>
                    {REWARD_STATUS[r.status]?.label ?? r.status}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
