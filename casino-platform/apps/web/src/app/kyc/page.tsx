'use client'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'

import { Field } from '@/components/ui/field'
import { toast } from '@/components/ui/toaster'
import { apiPost, errText } from '@/lib/api'
import { getKycStatus } from '@/lib/api/kyc.api'
import { API_BASE_URL as API_URL } from '@/lib/api-base'
import { formatAmount } from '@/lib/format/currency'
import { kycStatusLabel } from '@/lib/ui/kyc'
import { useAuth } from '@/stores/auth'

/** Спокойные цвета статуса верификации: палитра ч.5.1 §2, без дефолтов Tailwind. */
const KYC_STATUS_COLOR: Record<string, string> = {
  approved: 'text-[#00C853]',
  pending: 'text-[#FFB300]',
  rejected: 'text-[#FF3D71]',
  requires_resubmission: 'text-[#FFB300]',
}

type DocKey = 'front' | 'back' | 'selfie'

/**
 * §13: форма — «данные + загрузка документа + селфи» одним экраном. Разрешение
 * на загрузку документов шире, чем показ формы: на «на проверке» данные уже
 * не правятся, а дослать документ можно.
 */
const FORM_STATES = ['not_started', 'requires_resubmission', 'rejected']
const DOC_STATES = [...FORM_STATES, 'pending']

/** Слоты документов: подпись своя на каждой строке, а не обрезаемый span справа. */
const DOC_SLOTS: { key: DocKey; label: string }[] = [
  { key: 'front', label: 'Лицевая сторона' },
  { key: 'back', label: 'Обратная сторона' },
  { key: 'selfie', label: 'Селфи с документом' },
]

/** Форма персональных данных KYC (первый шаг заявки). */
function KycForm({
  form,
  onField,
  onSubmit,
}: {
  form: {
    first_name: string
    last_name: string
    date_of_birth: string
    country: string
    document_type: string
    document_number: string
    document_expiry: string
  }
  onField: (key: keyof typeof form, value: string) => void
  onSubmit: (e: React.FormEvent) => void
}): React.JSX.Element {
  return (
    <form id="kyc-form" onSubmit={onSubmit} className="card mb-6 space-y-3">
      <div className="font-semibold">Персональные данные</div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Имя">
          <input
            className="input"
            required
            onChange={(e) => onField('first_name', e.target.value)}
          />
        </Field>
        <Field label="Фамилия">
          <input
            className="input"
            required
            onChange={(e) => onField('last_name', e.target.value)}
          />
        </Field>
        <Field label="Дата рождения">
          <input
            className="input"
            type="date"
            required
            onChange={(e) => onField('date_of_birth', e.target.value)}
          />
        </Field>
        <Field label="Страна">
          <input
            className="input"
            defaultValue="RU"
            placeholder="Например, RU"
            onChange={(e) => onField('country', e.target.value)}
          />
        </Field>
        <Field label="Тип документа">
          <select className="input" onChange={(e) => onField('document_type', e.target.value)}>
            <option value="passport">Паспорт</option>
            <option value="id_card">ID карта</option>
            <option value="drivers_license">Водительское</option>
          </select>
        </Field>
        <Field label="Номер документа">
          <input
            className="input"
            required
            onChange={(e) => onField('document_number', e.target.value)}
          />
        </Field>
        <Field label="Срок действия">
          <input
            className="input"
            type="date"
            onChange={(e) => onField('document_expiry', e.target.value)}
          />
        </Field>
      </div>
      {/* Кнопки нет внутри формы: заявка подаётся кнопкой под блоком документов,
          иначе игрок жмёт «Подать заявку», не прикрепив ни одного файла (§13). */}
    </form>
  )
}

export default function KycPage(): React.JSX.Element {
  const { user } = useAuth()
  const { data, refetch } = useQuery({
    queryKey: ['kyc-status'],
    queryFn: () => getKycStatus(),
    enabled: Boolean(user),
  })
  const [form, setForm] = useState<{
    first_name: string
    last_name: string
    date_of_birth: string
    country: string
    document_type: string
    document_number: string
    document_expiry: string
  }>({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    country: 'RU',
    document_type: 'passport',
    document_number: '',
    document_expiry: '',
  })
  const [files, setFiles] = useState<Record<DocKey, File | null>>({
    front: null,
    back: null,
    selfie: null,
  })

  const setField = (key: keyof typeof form, value: string): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    void apiPost('/kyc/submit', form)
      .then(() => {
        toast.success('KYC заявка подана')
        void refetch()
      })
      .catch((err: unknown) => {
        toast.error(errText(err) || 'Ошибка')
      })
  }
  const uploadDoc = async (type: DocKey): Promise<void> => {
    const file = files[type]
    if (!file) {
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    fd.append('document_type', type)
    try {
      await fetch(
        API_URL + '/kyc/documents',
        {
          method: 'POST',
          body: fd,
          credentials: 'include',
        },
      )
      toast.success('Документ загружен')
      void refetch()
    } catch {
      toast.error('Ошибка загрузки')
    }
  }

  if (!user) {
    return <div className="container-1 py-8">Войдите в аккаунт</div>
  }
  const status = data?.status || 'not_started'
  const remaining = data?.limit_remaining
  const remainingExhausted = remaining !== undefined && Number(remaining) <= 0

  return (
    <div className="container-1 py-8 max-w-2xl">
      <p className="caps-label">ПРОВЕРКА АККАУНТА</p>
      <h1 className="page-title mb-2">KYC Верификация</h1>
      {status === 'approved' ? (
        <div className="text-sm text-muted mb-6">
          Лимит снят: пополнения и выводы доступны без ограничений.
        </div>
      ) : (
        <div className="text-sm text-muted mb-6">
          {/* GAP-36: значения — из API, не пересчёт на клиенте */}
          Остаток лимита без KYC:{' '}
          <b className={remainingExhausted ? 'text-[#FF3D71]' : 'text-white'}>
            {data ? formatAmount(data.limit_remaining, data.limit_currency, true) : '…'}
          </b>{' '}
          из{' '}
          <b className="text-white">
            {data ? formatAmount(data.deposit_limit_rub, 'RUB') : '5 000 ₽'}
          </b>{' '}
          суммарных пополнений. Вывод всегда требует KYC.
        </div>
      )}
      {remainingExhausted && status !== 'approved' && (
        <div className="card mb-6 border-[#FF3D71]/40">
          <div className="text-[#FF3D71] font-semibold">Лимит пополнений исчерпан</div>
          <div className="text-sm text-muted mt-1">
            Дальнейшие пополнения — после верификации личности.
          </div>
          <a href="#kyc-form" className="btn mt-3 inline-block">
            Пройти верификацию
          </a>
        </div>
      )}
      <div className="card mb-6">
        Статус:{' '}
        <b className={KYC_STATUS_COLOR[status] ?? 'text-muted'}>
          {kycStatusLabel(status)}
        </b>
        {data?.rejectionReason && (
          <div className="text-[#FF3D71] text-sm mt-2">Причина: {data.rejectionReason}</div>
        )}
        {data?.documents && data.documents.length > 0 && (
          <div className="text-xs text-muted mt-2">
            Загружено документов: {data.documents.join(', ')}
          </div>
        )}
      </div>

      {FORM_STATES.includes(status) && (
        <KycForm form={form} onField={setField} onSubmit={submit} />
      )}

      {DOC_STATES.includes(status) && (
        <div className="card space-y-3">
          <div className="font-semibold">Загрузка документов</div>
          {DOC_SLOTS.map((slot) => (
            <div key={slot.key} className="rounded-xl border border-[#2A2A4A] p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-sm">{slot.label}</span>
                <span className="truncate text-xs text-muted">
                  {files[slot.key]?.name ?? 'не выбран'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="btn-ghost cursor-pointer px-3 py-1.5 text-xs">
                  Выбрать файл
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="sr-only"
                    onChange={(e) =>
                      setFiles((f) => ({ ...f, [slot.key]: e.target.files?.[0] ?? null }))
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void uploadDoc(slot.key)}
                  disabled={!files[slot.key]}
                  className="btn px-3 py-1.5 text-xs"
                >
                  Загрузить
                </button>
              </div>
            </div>
          ))}
          <div className="text-xs text-muted">JPG / PNG / PDF, до 10 MB</div>
        </div>
      )}
      {FORM_STATES.includes(status) && (
        <button type="submit" form="kyc-form" className="btn mt-6 w-full">
          Подать заявку KYC
        </button>
      )}
      {status === 'approved' && (
        <div className="card flex items-start gap-2 text-[#00C853]">
          <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>Верификация пройдена. Пополнения и выводы доступны без ограничений.</span>
        </div>
      )}
    </div>
  )
}
