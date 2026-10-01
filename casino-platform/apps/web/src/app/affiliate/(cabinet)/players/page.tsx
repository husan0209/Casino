'use client'
import { useQuery } from '@tanstack/react-query'

import { affiliateGet } from '@/lib/affiliate-api'
import {
  formatAmount,
  rejectReasonLabel,
  statusLabel,
  statusToneClass,
} from '@/lib/affiliate-format'
import { type AffiliatePlayerDto } from '@/types/affiliate'

/**
 * Приведённые игроки.
 *
 * Отказ показываем с ЧЕЛОВЕЧЕСКИМ объяснением, а не enum-кодом: партнёр должен
 * понимать, что поправить в своём трафике. Например, `self_referral` означает,
 * что он привёл самого себя с одного устройства — это его исправимо.
 */
export default function AffiliatePlayersPage(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['aff-players'],
    queryFn: () =>
      affiliateGet<{ data: AffiliatePlayerDto[]; meta: { total: number } }>('/affiliate/players'),
  })

  const players = data?.data ?? []
  const total = data?.meta.total ?? 0
  const qualified = players.filter((p) => p.status === 'qualified').length
  const rejected = players.filter((p) => p.status === 'rejected').length

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* «Квалифицировано» — одно слово, в three-column сетке на 390px оно не влезает
            в text-sm и обрезается карточкой: перенос разрешён явно. */}
        <div className="card">
          <div className="text-muted text-xs leading-tight break-words">Всего</div>
          <div className="text-2xl font-black mt-1">{total}</div>
        </div>
        <div className="card">
          <div className="text-muted text-xs leading-tight break-words">Квалифицировано</div>
          <div className="text-2xl font-black mt-1 text-[#00C853]">{qualified}</div>
        </div>
        <div className="card">
          <div className="text-muted text-xs leading-tight break-words">Отклонено</div>
          <div className="text-2xl font-black mt-1 text-[#FF3D71]">{rejected}</div>
        </div>
      </div>

      {isLoading && <div className="text-muted text-sm py-6">Загрузка…</div>}

      {!isLoading && players.length === 0 && (
        <div className="card text-muted text-sm">
          Пока никто не зарегистрировался по вашей ссылке. Атрибуция срабатывает в течение{' '}
          cookie-окна после клика.
        </div>
      )}

      {players.length > 0 && (
        <>
          <div className="hidden md:block card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {['ID игрока', 'Статус', 'Депозиты', 'Первый депозит', 'Причина отказа'].map(
                    (title) => (
                      <th
                        key={title}
                        className="text-left text-[11px] uppercase tracking-wide text-[#8888AA] px-3 py-2.5"
                      >
                        {title}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {players.map((player) => {
                  const status = statusLabel(player.status)
                  const reason = rejectReasonLabel(player.reject_reason)
                  return (
                    <tr key={player.player_id} className="border-b border-white/5 last:border-0">
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {player.player_id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-xs ${statusToneClass(status.tone)}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-right">
                        {formatAmount(player.total_deposit, 'RUB')}
                        {player.deposit_count > 0 && (
                          <span className="text-[#8888AA] text-xs"> · {player.deposit_count}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[#8888AA]">
                        {player.first_deposit_at !== null
                          ? player.first_deposit_at.slice(0, 10)
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-[#FFB300] text-xs">{reason ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {players.map((player) => {
              const status = statusLabel(player.status)
              const reason = rejectReasonLabel(player.reject_reason)
              return (
                <div key={player.player_id} className="card">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs">{player.player_id.slice(0, 8)}</span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs ${statusToneClass(status.tone)}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <div className="text-sm text-muted">
                    Депозиты:{' '}
                    <span className="font-mono text-white">
                      {formatAmount(player.total_deposit, 'RUB')}
                    </span>
                  </div>
                  {reason !== null && (
                    <div className="text-sm text-[#FFB300] mt-1">Причина: {reason}</div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="card mt-4">
        <div className="font-semibold mb-1">Почему игрок может не засчитаться</div>
        <div className="text-muted text-sm space-y-1">
          <div>
            <b>Ожидает</b> — игрок зарегистрировался, но ещё не сделал депозит или не прошёл KYC.
            Как только условия выполнены, статус изменится автоматически.
          </div>
          <div>
            <b>Самопривлечение</b> — регистрация с того же IP или браузера, что и ваш последний клик
            по ссылке. Не приводите игроков с личного устройства.
          </div>
          <div>
            <b>Подозрение на флуд</b> — слишком много игроков с одного IP за сутки. Обычно означает
            накрутку.
          </div>
          <div>
            <b>Игрок самоисключился</b> — он отказался от игры. Начисления по нему отменяются, сумма
            возвращается.
          </div>
        </div>
      </div>
    </div>
  )
}
