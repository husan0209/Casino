'use client'

import { Check, Clock, Copy } from 'lucide-react'
import { useState } from 'react'

import { pollDepositStatus, type CryptoDepositTicket } from '@/lib/api/wallet.api'
import { currencyLabel, formatAmount, networkLabel } from '@/lib/format/currency'

/**
 * ТЗ ч.5.1 §4.9 «DepositSheet (крипта)»: сеть крупно и всегда, предупреждение
 * «только X в сети Y», адрес с копированием, дедлайн, «Проверить статус» и факт
 * зачисления. Редиректа на платёжку здесь нет — игрок отправляет сам, поэтому
 * статус опрашивается по кнопке.
 */

const CLOSED = ['failed', 'expired', 'cancelled']

function deadlineLabel(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 'Срок заявки истёк'
  }
  if (minutes < 60) {
    return `Адрес действует ещё ${minutes} мин`
  }
  const until = new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  return `Адрес действует до ${until}`
}

export function CryptoDepositTicketPanel({
  ticket,
  onCredited,
  onClose,
}: {
  ticket: CryptoDepositTicket
  onCredited: () => void
  onClose: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [checking, setChecking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const network = networkLabel(ticket.pay_currency)
  const coin = currencyLabel(ticket.pay_currency)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(ticket.pay_address)
      setCopied(true)
      setNotice(null)
    } catch {
      setNotice('Браузер не дал доступ к буферу — скопируйте адрес вручную.')
    }
  }

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      const st = await pollDepositStatus(ticket.payment_request_id)
      if (st.status === 'completed') {
        onCredited()
        return
      }
      setNotice(
        CLOSED.includes(st.status)
          ? 'Заявка закрылась. Откройте пополнение заново — адрес будет новый.'
          : 'Платёж ещё не подтверждён. Проверьте сеть и сумму: должно совпасть с заявкой до последнего знака.',
      )
    } catch {
      setNotice('Не удалось проверить статус. Попробуйте ещё раз.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-[#2A2A4A] bg-[#16213E] p-4">
        <p className="caps-label">Сеть</p>
        <p className="mt-1 flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight">{network}</span>
          <span className="rounded-md bg-[#00D2FF]/15 px-2 py-0.5 text-xs font-semibold text-[#00D2FF]">
            {coin}
          </span>
        </p>
        <p className="mt-2 text-sm text-[#FFB300]">
          Отправьте только {coin} в сети {network}. Другая монета или сеть — деньги не вернутся.
        </p>
      </div>

      <div className="rounded-xl border border-[#2A2A4A] p-4">
        <p className="text-xs text-muted">Сумма к отправке</p>
        <p className="mt-1 text-2xl font-bold text-[#00C853]">
          {formatAmount(ticket.pay_amount, ticket.pay_currency)}
        </p>
        <p className="mt-1 text-xs text-muted">
          Зачисляем в кошельке {coin} — без конвертации в другие валюты.
        </p>
      </div>

      <div>
        <p className="text-xs text-muted">Адрес</p>
        <div className="mt-1 flex items-start gap-2 rounded-xl border border-[#2A2A4A] bg-white/[0.03] p-3">
          <span className="min-w-0 flex-1 break-all font-mono text-sm">{ticket.pay_address}</span>
          <button
            type="button"
            onClick={() => void copy()}
            className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
            aria-label="Скопировать адрес"
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <Clock size={12} aria-hidden />
          {deadlineLabel(ticket.expires_at)}
        </p>
      </div>

      {notice && (
        <p aria-live="polite" className="rounded-lg bg-white/[0.04] p-2.5 text-xs text-muted">
          {notice}
        </p>
      )}

      <button
        type="button"
        onClick={() => void check()}
        disabled={checking}
        className="btn-money w-full py-3"
      >
        {checking ? 'Проверяем…' : 'Проверить статус'}
      </button>
      <button type="button" onClick={onClose} className="w-full text-xs text-muted">
        Закрыть
      </button>
    </div>
  )
}
