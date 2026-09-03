'use client'
import { useQuery } from '@tanstack/react-query'

import { toast } from '@/components/ui/toaster'
import { apiGet } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import type { ReferralInfoDto, ReferralRewardsDto } from '@/types/referral'

export default function ReferralPage() {
  const { user } = useAuth()
  const { data: info } = useQuery({
    queryKey: ['ref-info'],
    queryFn: () => apiGet<ReferralInfoDto>('/referrals/info'),
    enabled: Boolean(user),
  })
  const { data: list } = useQuery({
    queryKey: ['ref-list'],
    queryFn: () => apiGet<{ data: { id: string; status: string; created_at: string }[] }>('/referrals/list'),
    enabled: Boolean(user),
  })
  void list
  const { data: rewards } = useQuery({
    queryKey: ['ref-rewards'],
    queryFn: () => apiGet<ReferralRewardsDto>('/referrals/rewards'),
    enabled: Boolean(user),
  })
  if (!user) {
    return <div className="container-1 py-8">Войдите, чтобы получить реферальную ссылку</div>
  }
  return (
    <div className="container-1 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Реферальная программа</h1>
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <div className="text-muted text-sm">Рефералы</div>
          <div className="text-2xl font-bold">{info?.total_referrals ?? 0}</div>
        </div>
        <div className="card">
          <div className="text-muted text-sm">Заработано</div>
          <div className="text-2xl font-bold">{info?.total_earned?.RUB || '0'} ₽</div>
        </div>
        <div className="card">
          <div className="text-muted text-sm">Ставка</div>
          <div className="text-2xl font-bold">{info?.reward_rate || '5%'}</div>
        </div>
      </div>
      <div className="card mb-6">
        <div className="text-sm text-muted">Ваша ссылка</div>
        <div className="flex gap-2 mt-1">
          <input readOnly value={info?.referral_link || ''} className="input" />
          <button
            onClick={() => {
              void navigator.clipboard.writeText(info?.referral_link || '')
              toast.success('Скопировано')
            }}
            className="btn-ghost text-sm"
          >
            Копировать
          </button>
        </div>
        <div className="text-xs text-muted mt-2">
          Код: <b>{info?.referral_code}</b> • 5% от GGR рефералов ежедневно
        </div>
      </div>
      <div className="card">
        <div className="font-semibold mb-2">Последние начисления</div>
        <table className="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>GGR</th>
              <th>Награда</th>
              <th>Валюта</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {(rewards?.data ?? []).slice(0, 20).map((r) => (
              <tr key={r.id}>
                <td>{String(r.periodStart).slice(0, 10)}</td>
                <td>{r.ggrAmount}</td>
                <td>{r.rewardAmount}</td>
                <td>{r.currency}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!rewards?.data || rewards.data.length === 0) && (
          <div className="text-muted text-sm py-4">Начислений пока нет</div>
        )}
      </div>
    </div>
  )
}
