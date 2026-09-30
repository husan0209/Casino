'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Btn, Card, ErrorBox, Input, Loading, PageTitle, Select, Td, Th } from '@/components/ui'
import { apiGet, apiPost, errText } from '@/lib/api'
import { type AdminAffiliateSettingsDto } from '@/types/affiliate'

/**
 * Настройки программы (только superadmin на бэкенде).
 *
 * Ставка по умолчанию здесь — «витрина» для новых партнёров. Она НЕ является
 * ставкой конкретного партнёра: индивидуальная ставка перекрывает её и задаётся
 * в карточке партнёра. Поэтому поле подписано именно так, чтобы админ не искал
 * здесь «ставку этого партнёра».
 */
export default function AffiliateSettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | undefined>(undefined)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: ['aff-settings-admin'],
    queryFn: () => apiGet<AdminAffiliateSettingsDto>('/admin/affiliate/settings'),
  })

  const save = useMutation({
    mutationFn: (input: { key: string; value: string; type: string }) =>
      apiPost<{ key: string; value: string }>('/admin/affiliate/settings', input),
    onSuccess: (result) => {
      setError(undefined)
      setSavedKey(result.key)
      void queryClient.invalidateQueries({ queryKey: ['aff-settings-admin'] })
    },
    onError: (err: unknown) => setError(errText(err)),
  })

  if (settings.isLoading) {
    return <Loading />
  }
  if (settings.data === undefined) {
    return <ErrorBox msg="Не удалось загрузить настройки" />
  }

  const values = settings.data.settings
  // Индекс в Record<string, string> даёт string | undefined (noUncheckedIndexedAccess),
  // а редакторы ниже требуют гарантированную строку. Пропущенный ключ — это
  // отсутствующая настройка, а не «пустая»: подставляем дефолт на бэкенде.
  const read = (key: string, fallback: string): string => values[key] ?? fallback

  return (
    <div>
      <PageTitle>Настройки программы</PageTitle>
      <ErrorBox msg={error} />

      <Card className="mb-4">
        <div className="font-semibold mb-1">Ставка RevShare по умолчанию</div>
        <div className="text-xs text-[#ffb300] mb-3">
          ⚠ Применяется только к НОВЫМ партнёрам. Уже зарегистрированные партнёры сохраняют свою
          ставку. Изменение не пересчитывает закрытые периоды.
        </div>
        <RateEditor
          label="Ставка по умолчанию"
          hint="Доля от NGR. 0.20 = 20%. Рыночный диапазон для новых партнёров 0.20–0.25."
          value={read('default_revshare_rate', '0.2000')}
          isPercent
          busy={save.isPending}
          saved={savedKey === 'affiliate_default_revshare_rate'}
          onSave={(value) =>
            save.mutate({ key: 'affiliate_default_revshare_rate', value, type: 'number' })
          }
        />
      </Card>

      <Card className="mb-4">
        <div className="font-semibold mb-3">Квалификация и выплаты</div>
        <div className="space-y-4">
          <BoolEditor
            label="Программа включена"
            hint="Выключение останавливает атрибуцию: клики и регистрации не привязываются."
            value={read('enabled', 'true') === 'true'}
            busy={save.isPending}
            saved={savedKey === 'affiliate_enabled'}
            onSave={(value) =>
              save.mutate({ key: 'affiliate_enabled', value: String(value), type: 'boolean' })
            }
          />
          <BoolEditor
            label="Требовать KYC"
            hint="Игрок без подтверждённого KYC не квалифицируется, начислений нет."
            value={read('require_kyc', 'true') === 'true'}
            busy={save.isPending}
            saved={savedKey === 'affiliate_require_kyc'}
            onSave={(value) =>
              save.mutate({ key: 'affiliate_require_kyc', value: String(value), type: 'boolean' })
            }
          />
          <BoolEditor
            label="Перенос отрицательного NGR"
            hint="Выключено (рекомендуется): партнёр не платит за убыточных игроков. Включение защищает оператора, но партнёры торгуются именно за «no negative carryover»."
            value={read('negative_carryover', 'false') === 'true'}
            busy={save.isPending}
            saved={savedKey === 'affiliate_negative_carryover'}
            onSave={(value) =>
              save.mutate({
                key: 'affiliate_negative_carryover',
                value: String(value),
                type: 'boolean',
              })
            }
          />
          <NumberEditor
            label="Порог допуска, ₽"
            hint="Депозит ниже порога оставляет атрибуцию в «ожидании». 0 — без порога."
            value={read('min_deposit_rub', '0')}
            busy={save.isPending}
            saved={savedKey === 'affiliate_min_deposit'}
            onSave={(value) => save.mutate({ key: 'affiliate_min_deposit', value, type: 'number' })}
          />
        </div>
      </Card>

      <Card className="mb-4">
        <div className="font-semibold mb-3">Трекинг и антифрод</div>
        <div className="space-y-4">
          <NumberEditor
            label="Cookie-окно атрибуции, дней"
            hint="Рыночная норма 30–90. Меньше 30 — ниже рынка."
            value={read('cookie_days', '30')}
            busy={save.isPending}
            saved={savedKey === 'affiliate_cookie_days'}
            onSave={(value) => save.mutate({ key: 'affiliate_cookie_days', value, type: 'number' })}
          />
          <NumberEditor
            label="Порог флуд трафика (игроков с IP за сутки)"
            hint="Превышение помечает атрибуцию как ip_flood. 0 отключает проверку."
            value={read('auto_suspend_threshold', '20')}
            busy={save.isPending}
            saved={savedKey === 'affiliate_auto_suspend_threshold'}
            onSave={(value) =>
              save.mutate({ key: 'affiliate_auto_suspend_threshold', value, type: 'number' })
            }
          />
          <NumberEditor
            label="Retention кликов, дней"
            hint="Должен быть ≥ cookie-окна: иначе к моменту регистрации не останется свежих кликов и самопривлечение не обнаружится."
            value={read('click_retention_days', '180')}
            busy={save.isPending}
            saved={savedKey === 'affiliate_click_retention_days'}
            onSave={(value) =>
              save.mutate({ key: 'affiliate_click_retention_days', value, type: 'number' })
            }
          />
        </div>
      </Card>

      <Card>
        <div className="font-semibold mb-3">История изменений</div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Ключ</Th>
              <Th>Значение</Th>
              <Th>Тип</Th>
              <Th>Изменён</Th>
            </tr>
          </thead>
          <tbody>
            {settings.data.raw.map((row) => (
              <tr key={row.key}>
                <Td className="font-mono text-xs">{row.key}</Td>
                <Td className="font-mono text-xs">{row.value}</Td>
                <Td className="text-[#8b8ba7] text-xs">{row.type}</Td>
                <Td className="text-[#8b8ba7] text-xs">
                  {row.updated_at.slice(0, 16).replace('T', ' ')}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function RateEditor({
  label,
  hint,
  value,
  isPercent,
  busy,
  saved,
  onSave,
}: {
  label: string
  hint: string
  value: string
  isPercent: boolean
  busy: boolean
  saved: boolean
  onSave: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const percent = (Number(draft || 0) * 100).toFixed(1)

  return (
    <div>
      <div className="text-sm font-medium mb-1">{label}</div>
      <div className="text-xs text-[#8b8ba7] mb-2">{hint}</div>
      <div className="flex items-end gap-2">
        <Input
          small
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-32 font-mono"
        />
        {isPercent && (
          <span className="text-sm text-[#8b8ba7] pb-1">
            = <b className="text-white">{percent}%</b>
          </span>
        )}
        <Btn small onClick={() => onSave(draft)} disabled={busy}>
          Сохранить
        </Btn>
        {saved && <span className="text-xs text-emerald-400 pb-1">Сохранено</span>}
      </div>
    </div>
  )
}

function NumberEditor({
  label,
  hint,
  value,
  busy,
  saved,
  onSave,
}: {
  label: string
  hint: string
  value: string
  busy: boolean
  saved: boolean
  onSave: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)

  return (
    <div>
      <div className="text-sm font-medium mb-1">{label}</div>
      <div className="text-xs text-[#8b8ba7] mb-2">{hint}</div>
      <div className="flex items-center gap-2">
        <Input
          small
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-32 font-mono"
        />
        <Btn small onClick={() => onSave(draft)} disabled={busy}>
          Сохранить
        </Btn>
        {saved && <span className="text-xs text-emerald-400">Сохранено</span>}
      </div>
    </div>
  )
}

function BoolEditor({
  label,
  hint,
  value,
  busy,
  saved,
  onSave,
}: {
  label: string
  hint: string
  value: boolean
  busy: boolean
  saved: boolean
  onSave: (value: boolean) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)

  return (
    <div>
      <div className="text-sm font-medium mb-1">{label}</div>
      <div className="text-xs text-[#8b8ba7] mb-2">{hint}</div>
      <div className="flex items-center gap-2">
        <Select
          value={draft ? 'true' : 'false'}
          onChange={(e) => setDraft(e.target.value === 'true')}
          className="max-w-[140px]"
        >
          <option value="true">Включено</option>
          <option value="false">Выключено</option>
        </Select>
        <Btn small onClick={() => onSave(draft)} disabled={busy}>
          Сохранить
        </Btn>
        {saved && <span className="text-xs text-emerald-400">Сохранено</span>}
      </div>
    </div>
  )
}
