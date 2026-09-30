'use client'
import { useQuery } from '@tanstack/react-query'

import { Badge, Card, Loading, PageTitle, Td, Th } from '@/components/ui'
import { apiGet } from '@/lib/api'
import { type AdminAffiliateOverviewDto, type AdminAffiliateSettingsDto } from '@/types/affiliate'

/**
 * Значения статусов начислений.
 *
 * Явная аннотация `Array<[string, string]>` обязательна: без неё TypeScript
 * выводит `string[][]`, и деструктуризация `[status, meaning]` даёт
 * `string | undefined` (noUncheckedIndexedAccess).
 */
const COMMISSION_STATUS_MEANINGS: Array<[string, string]> = [
  ['pending', 'Создано, ещё не зачислено на кошелёк партнёра'],
  ['approved', 'Зачислено на кошелёк (идемпотентно)'],
  ['paid', 'Выплачено (в MVP начисляется на баланс)'],
  ['cancelled', 'Отменено: самоисключение, фрод, ручной отзыв'],
]

/**
 * Сводка партнёрской программы.
 *
 * Показываем именно NGR, а не «прибыль»: оператор видит базу начислений и
 * понимает, сколько партнёр фактически принёс. Это же число партнёр видит у
 * себя — расхождение между двумя экранами разрушает доверие быстрее любой
 * ошибки округления (ТЗ ч.8 §3.9).
 */
export default function AffiliateOverviewPage(): React.JSX.Element {
  const overview = useQuery({
    queryKey: ['aff-overview'],
    queryFn: () => apiGet<AdminAffiliateOverviewDto>('/admin/affiliate/overview'),
  })
  const settings = useQuery({
    queryKey: ['aff-settings'],
    queryFn: () => apiGet<AdminAffiliateSettingsDto>('/admin/affiliate/settings'),
  })

  const partners = overview.data?.partners

  return (
    <div>
      <PageTitle>Партнёрская программа</PageTitle>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <div className="text-sm text-[#8b8ba7]">Партнёров всего</div>
          <div className="text-2xl font-bold mt-1">{partners?.total ?? '…'}</div>
          <div className="text-xs text-[#8b8ba7] mt-1">
            активных: {partners?.active ?? '…'} · приостановленных: {partners?.suspended ?? '…'}
          </div>
        </Card>
        <Card>
          <div className="text-sm text-[#8b8ba7]">Выплачено комиссий</div>
          <div className="text-2xl font-bold mt-1 text-emerald-400">
            {overview.data
              ? `${Number(overview.data.revenue.total_commission).toLocaleString('ru-RU', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              : '…'}
          </div>
          <div className="text-xs text-[#8b8ba7] mt-1">по 100 последним начислениям</div>
        </Card>
        <Card>
          <div className="text-sm text-[#8b8ba7]">Суммарный NGR</div>
          <div className="text-2xl font-bold mt-1">
            {overview.data
              ? Number(overview.data.revenue.total_ngr).toLocaleString('ru-RU', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : '…'}
          </div>
          <div className="text-xs text-[#8b8ba7] mt-1">база начислений RevShare</div>
        </Card>
        <Card>
          <div className="text-sm text-[#8b8ba7]">Ставка по умолчанию</div>
          <div className="text-2xl font-bold mt-1 text-[#ff3b7a]">
            {settings.data ? `${settings.data.revshare_percent}%` : '…'}
          </div>
          <div className="text-xs text-[#8b8ba7] mt-1">для новых партнёров</div>
        </Card>
      </div>

      {/* Ключевые настройки — на главном экране, потому что их чаще всего
          проверяют именно тут, а не в отдельном разделе. */}
      {settings.data !== undefined && (
        <Card className="mb-6">
          <div className="font-semibold mb-3">Настройки программы</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              ['Программа включена', settings.data.settings.enabled === 'true' ? 'да' : 'нет'],
              ['Cookie-окно, дней', settings.data.settings.cookie_days],
              ['Порог депозита, ₽', settings.data.settings.min_deposit_rub],
              ['Требовать KYC', settings.data.settings.require_kyc === 'true' ? 'да' : 'нет'],
              [
                'Отрицательный перенос',
                settings.data.settings.negative_carryover === 'true' ? 'включён' : 'выключен',
              ],
              ['Retention кликов, дней', settings.data.settings.click_retention_days],
              ['Порог флуд/IP', settings.data.settings.auto_suspend_threshold],
              ['Версия условий', settings.data.settings.terms_version],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[#8b8ba7] text-xs">{label}</div>
                <div className="font-medium mt-0.5">{value}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <h2 className="font-semibold mb-3">Статусы начислений</h2>
      <Card>
        {overview.isLoading && <Loading />}
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Статус</Th>
              <Th>Что означает</Th>
            </tr>
          </thead>
          <tbody>
            {COMMISSION_STATUS_MEANINGS.map(([status, meaning]) => (
              <tr key={status}>
                <Td>
                  <Badge value={status} />
                </Td>
                <Td className="text-[#8b8ba7]">{meaning}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
