'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { apiPost, errText } from '@/lib/api'
import { getKycStatus } from '@/lib/api/kyc.api'
import { formatAmount } from '@/lib/format/currency'
import { useAuth } from '@/stores/auth'

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
    <form id="kyc-form" onSubmit={onSubmit} className="card space-y-3 mb-6">
      <div className="font-semibold">Персональные данные</div>
      <div className="grid md:grid-cols-2 gap-3">
        <input
          className="input"
          placeholder="Имя"
          required
          onChange={(e) => onField('first_name', e.target.value)}
        />
        <input
          className="input"
          placeholder="Фамилия"
          required
          onChange={(e) => onField('last_name', e.target.value)}
        />
        <input
          className="input"
          type="date"
          required
          onChange={(e) => onField('date_of_birth', e.target.value)}
        />
        <input
          className="input"
          placeholder="Страна (RU)"
          defaultValue="RU"
          onChange={(e) => onField('country', e.target.value)}
        />
        <select className="input" onChange={(e) => onField('document_type', e.target.value)}>
          <option value="passport">Паспорт</option>
          <option value="id_card">ID карта</option>
          <option value="drivers_license">Водительское</option>
        </select>
        <input
          className="input"
          placeholder="Номер документа"
          required
          onChange={(e) => onField('document_number', e.target.value)}
        />
        <input
          className="input"
          type="date"
          placeholder="Срок действия"
          onChange={(e) => onField('document_expiry', e.target.value)}
        />
      </div>
      <button className="btn">Подать заявку KYC</button>
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
  const [files, setFiles] = useState<Record<string, File | null>>({
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
  const uploadDoc = async (type: string): Promise<void> => {
    const file = files[type]
    if (!file) {
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    fd.append('document_type', type)
    try {
      await fetch(
        (process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1') + '/kyc/documents',
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

  return (
    <div className="container-1 py-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">KYC Верификация</h1>
      {/* Верификация нужна, чтобы вывести больше порога. Пополнение счёта вообще
          без неё и без верхней границы — прежний лимит суммарных пополнений снят
          (решение владельца 2026-10-07), поэтому здесь нет ни «остатка лимита
          пополнения», ни красной карточки про него. Порог вывода — суммарный:
          бэк вычитает уже выведенное и замороженное, поэтому цифра честная, а не
          «5 000 ₽ на каждую заявку». */}
      <div className="text-sm text-muted mb-6">
        {status === 'approved'
          ? 'Верификация пройдена: вывод средств доступен без лимита по сумме.'
          : data
            ? `Пополнять счёт можно без верификации. Вывод до ${formatAmount(
                data.withdraw_limit_rub,
                'RUB',
              )} — тоже без неё; сверх этого вывод только после верификации.`
            : 'Пополнять счёт можно без верификации. Вывод сверх порога — после неё.'}
      </div>
      {status !== 'approved' && data && (
        <div className="card mb-6 text-sm">
          Без верификации доступно ещё <b>{formatAmount(data.withdraw_remaining_rub, 'RUB')}</b>
          {' — уже выведено и в заявках: '}
          {formatAmount(data.withdrawn_rub, 'RUB')}
        </div>
      )}
      <div className="card mb-6">
        Статус:{' '}
        <b
          className={
            status === 'approved'
              ? 'text-emerald-400'
              : status === 'pending'
                ? 'text-amber-400'
                : status === 'rejected'
                  ? 'text-red-400'
                  : 'text-muted'
          }
        >
          {status}
        </b>
        {data?.rejectionReason && (
          <div className="text-red-400 text-sm mt-2">Причина: {data.rejectionReason}</div>
        )}
        {data?.documents && data.documents.length > 0 && (
          <div className="text-xs text-muted mt-2">
            Загружено документов: {data.documents.join(', ')}
          </div>
        )}
      </div>

      {(status === 'not_started' ||
        status === 'requires_resubmission' ||
        status === 'rejected') && <KycForm form={form} onField={setField} onSubmit={submit} />}

      {(status === 'pending' || status === 'requires_resubmission') && (
        <div className="card space-y-3">
          <div className="font-semibold">Загрузка документов</div>
          {(['front', 'back', 'selfie'] as const).map((t) => (
            <div key={t} className="flex gap-2 items-center">
              <input
                type="file"
                accept="image/*,.pdf"
                className="text-sm"
                onChange={(e) => setFiles((f) => ({ ...f, [t]: e.target.files?.[0] ?? null }))}
              />
              <span className="text-sm text-muted w-32">
                {t === 'front' ? 'Лицевая' : t === 'back' ? 'Обратная' : 'Селфи'}
              </span>
              <button onClick={() => uploadDoc(t)} className="btn-ghost text-xs px-3 py-1.5">
                Загрузить
              </button>
            </div>
          ))}
          <div className="text-xs text-muted">JPG / PNG / PDF, до 10 MB</div>
        </div>
      )}
      {status === 'approved' && (
        <div className="card text-emerald-400">
          ✅ Верификация пройдена. Пополнения и выводы доступны без ограничений.
        </div>
      )}
    </div>
  )
}
