'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Badge, Btn, Card, ErrorBox, Input, Loading, PageTitle, Select } from '@/components/ui'
import { apiGet, apiPatch, errText } from '@/lib/api'
import { type AdminAffiliateDetailDto } from '@/types/affiliate'

/**
 * Карточка партнёра: индивидуальная ставка, статус, ручные операции.
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ЭКРАНА: изменение ставки НЕ применяется задним числом.
 * Уже рассчитанные начисления хранят снимок revshare_rate, новая ставка
 * действует со СЛЕДУЮЩЕГО периода. Об этом сказано прямо в подсказке, потому
 * что админ, не увидев этого предупреждения, ожидал бы пересчёта истории — а
 * чтобы его дать, пришлось бы отзывать уже зачисленные деньги (ТЗ ч.8 §11.2).
 */
export default function AffiliatePartnerCardPage(): React.JSX.Element {
  const params = useParams<{ id: string }>()
  const partnerId = params.id
  const queryClient = useQueryClient()

  const [rate, setRate] = useState('')
  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const partner = useQuery({
    queryKey: ['aff-partner', partnerId],
    queryFn: () => apiGet<AdminAffiliateDetailDto>(`/admin/affiliate/partners/${partnerId}`),
  })

  // Заполняем форму один раз: перезапись на каждый рефетч сбрасывала бы правки.
  useEffect(() => {
    if (partner.data === undefined) {
      return
    }
    setRate(partner.data.revshare_rate)
    setStatus(partner.data.status)
    setReason(partner.data.suspended_reason ?? '')
  }, [partner.data])

  const save = useMutation({
    mutationFn: () =>
      apiPatch<{ id: string; revshare_rate: string; status: string }>(
        `/admin/affiliate/partners/${partnerId}`,
        {
          revshare_rate: rate,
          status,
          suspended_reason: reason.trim() === '' ? null : reason.trim(),
        },
      ),
    onSuccess: () => {
      setError(undefined)
      void queryClient.invalidateQueries({ queryKey: ['aff-partner', partnerId] })
    },
    onError: (err: unknown) => setError(errText(err)),
  })

  if (partner.isLoading) {
    return <Loading />
  }
  if (partner.data === undefined) {
    return <ErrorBox msg="Партнёр не найден" />
  }

  const data = partner.data

  return (
    <div>
      <PageTitle>Партнёр {data.email}</PageTitle>
      <ErrorBox msg={error} />

      <Card className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {[
            ['Код', data.tracking_code],
            ['Статус', <Badge key="s" value={data.status} />],
            ['Имя', data.display_name ?? '—'],
            ['Условия', `${data.terms_version}${data.is_agreed ? ' · приняты' : ' · не приняты'}`],
            ['Всего заработано', data.total_earned],
            ['Выплачено', data.total_paid],
            ['Текущая ставка', `${data.revshare_percent}`],
            ['Регистрация', data.created_at.slice(0, 10)],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <div className="text-[#8b8ba7] text-xs">{label}</div>
              <div className="font-medium mt-0.5">{value}</div>
            </div>
          ))}
        </div>
        {data.suspended_reason !== null && (
          <div className="mt-3 pt-3 border-t border-white/10 text-sm text-[#ff3b7a]">
            Причина блокировки: {data.suspended_reason}
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <div className="font-semibold mb-1">Индивидуальная ставка</div>
        <div className="text-xs text-[#ffb300] mb-3">
          ⚠ Ставка применяется только к будущим периодам. Уже рассчитанные начисления сохраняют
          прежний снимок ставки — пересчёта истории и отзыва выплат не происходит.
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="text-xs text-[#8b8ba7] mb-1">Ставка (доля от NGR)</div>
            <Input
              small
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="0.2000"
              className="w-32 font-mono"
            />
            <div className="text-[11px] text-[#8b8ba7] mt-1">0.20 = 20%. Диапазон 0…1</div>
          </div>
          <div className="text-sm text-[#8b8ba7] pb-1">
            = <b className="text-white">{(Number(rate || 0) * 100).toFixed(1)}%</b>
          </div>
        </div>
      </Card>

      <Card>
        <div className="font-semibold mb-3">Статус и блокировка</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-[#8b8ba7] mb-1">Статус</div>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="max-w-[200px]"
            >
              <option value="active">Активен</option>
              <option value="suspended">Приостановлен</option>
              <option value="rejected">Отклонён</option>
            </Select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="text-xs text-[#8b8ba7] mb-1">Причина (для аудита)</div>
            <Input
              small
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="например: нарушение правил рекламы, подозрение на фрод"
            />
          </div>
        </div>
        <div className="text-xs text-[#8b8ba7] mt-2">
          Приостановка не отзывает начисления за уже закрытые периоды — она лишь прекращает
          атрибуцию новых кликов.
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Btn onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить изменения'}
          </Btn>
          {save.isSuccess && (
            <span className="text-xs text-emerald-400">
              Сохранено. Изменение попало в аудит-лог.
            </span>
          )}
        </div>
      </Card>

      <div className="mt-4">
        <a href="/dashboard/affiliate/partners" className="text-sm text-[#ff3b7a] hover:underline">
          ← К списку партнёров
        </a>
      </div>
    </div>
  )
}
