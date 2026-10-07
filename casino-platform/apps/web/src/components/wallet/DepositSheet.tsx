'use client'
import {
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  Check,
  ChevronDown,
  Coins,
  CreditCard,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { CurrencyIcon } from '@/components/ui/CurrencyIcon'
import { toast } from '@/components/ui/toaster'
import { CryptoDepositTicketPanel } from '@/components/wallet/CryptoDepositTicket'
import { saveDepositContext } from '@/components/wallet/DepositReturnHandler'
import { errText } from '@/lib/api'
import {
  createCryptoDeposit,
  createFiatDeposit,
  type CryptoDepositTicket,
} from '@/lib/api/wallet.api'
import { currencyLabel, formatAmount, isCryptoCurrency } from '@/lib/format/currency'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

/** Иконка метода по подписи (в гео-конфиге только id+label, без типа).
    Крипта — настоящие логотипы монет; карта/P2P — нейтральные глифы
    (категории без одного бренда). Логотип СБП с wordmark в плитке 40px
    читается плохо — вернулись к нейтральной молнии (fast payments). */
function methodIcon(label: string): React.JSX.Element {
  const lower = label.toLowerCase()
  if (lower.includes('сбп')) {
    return <Zap size={18} aria-hidden />
  }
  if (lower.includes('p2p') || lower.includes('р2р')) {
    return <ArrowLeftRight size={18} aria-hidden />
  }
  if (lower.includes('btc') || lower.includes('bitcoin')) {
    return <CurrencyIcon currency="BTC" size={26} />
  }
  if (lower.includes('usdt')) {
    return <CurrencyIcon currency="USDT_TRC20" size={26} />
  }
  return <CreditCard size={18} aria-hidden />
}

interface PaymentMethodDto {
  id: string
  label: string
}

function MethodRow({
  method,
  selected,
  onSelect,
}: {
  method: PaymentMethodDto
  selected: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(method.id)}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-medium transition ${
        selected ? 'border-[#6C63FF] bg-white/[0.04]' : 'border-[#2A2A4A] hover:border-[#6C63FF]/50'
      }`}
    >
      <span className="icon-tile">{methodIcon(method.label)}</span>
      <span className="flex-1">{method.label}</span>
      {selected && <Check size={18} aria-hidden className="text-[#6C63FF]" />}
    </button>
  )
}

function MethodSection({
  mode,
  fiatMethods,
  cryptoMethods,
  method,
  showCrypto,
  setMethod,
  openCrypto,
  setMode,
  setShowCrypto,
}: {
  mode: 'fiat' | 'crypto'
  fiatMethods: PaymentMethodDto[]
  cryptoMethods: PaymentMethodDto[]
  method: string
  showCrypto: boolean
  setMethod: (id: string) => void
  openCrypto: () => void
  setMode: (m: 'fiat' | 'crypto') => void
  setShowCrypto: (v: boolean) => void
}): React.JSX.Element {
  if (mode === 'fiat') {
    return (
      <div className="mt-4 space-y-2">
        {fiatMethods.map((m) => (
          <MethodRow key={m.id} method={m} selected={method === m.id} onSelect={setMethod} />
        ))}
        {cryptoMethods.length > 0 && !showCrypto && (
          <button type="button" className="btn-ghost w-full text-sm" onClick={openCrypto}>
            <Coins size={16} aria-hidden />
            Ещё способы: {cryptoMethods.map((m) => m.label).join(', ')}
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-muted">Только USDT · TRC20 или BTC</p>
      {cryptoMethods.map((m) => (
        <MethodRow key={m.id} method={m} selected={method === m.id} onSelect={setMethod} />
      ))}
      <button
        type="button"
        className="btn-ghost w-full text-sm"
        onClick={() => {
          setMode('fiat')
          setShowCrypto(false)
        }}
      >
        <Banknote size={16} aria-hidden />
        Фиатные способы
      </button>
    </div>
  )
}

/** Шапка кассы и строка активного кошелька: пополняем ровно тот кошелёк, что выбран. */
function SheetTop({
  currency,
  balance,
  onClose,
  onSwitchWallet,
}: {
  currency: string
  balance: string
  onClose: () => void
  onSwitchWallet: () => void
}): React.JSX.Element {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <p className="caps-label">КАССА</p>
          <h2 className="text-lg font-bold">Пополнить {currencyLabel(currency)}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-white"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.03] px-3.5 py-2 text-xs border border-[#2A2A4A]/50">
        <span className="text-muted">Активный кошелёк</span>
        <button
          type="button"
          onClick={onSwitchWallet}
          className="flex items-center gap-1 font-semibold text-white hover:text-brand"
        >
          <span>{formatAmount(balance, currency, true)}</span>
          <ChevronDown size={14} aria-hidden className="text-muted" />
        </button>
      </div>
    </>
  )
}

/** Сумма: поле + пресеты активной валюты + минимум (§4.9, Часть 5 §2.5). */
function AmountField({
  currency,
  amount,
  onAmount,
  presets,
  min,
  error,
}: {
  currency: string
  amount: string
  onAmount: (value: string) => void
  presets: string[]
  min: string | undefined
  error: string | undefined
}): React.JSX.Element {
  return (
    <div className="mt-4">
      <label className="text-sm text-muted">Сумма, {currencyLabel(currency)}</label>
      <input
        className={`input mt-1 ${error ? 'outline outline-2 outline-[#FF3D71]/60' : ''}`}
        aria-invalid={error ? true : undefined}
        value={amount}
        onChange={(e) => onAmount(e.target.value)}
        /* Фиатная подсказка «2000» в поле USDT — тот же обман масштаба, из-за
           которого пресеты в крипто-кассе убраны. */
        placeholder={isCryptoCurrency(currency) ? '0.00' : '2000'}
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-[#FF6B81]">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className="btn-ghost px-3 py-1 text-xs"
            onClick={() => onAmount(p)}
          >
            {formatAmount(p, currency, true)}
          </button>
        ))}
      </div>
      {min && (
        <p className="mt-2 text-xs text-muted">Минимум {formatAmount(min, currency, true)}</p>
      )}
    </div>
  )
}

export function DepositSheet(): React.JSX.Element | null {
  const {
    depositSheet,
    depositSheetClosing,
    closeDeposit,
    depositCurrency,
    pendingGameSlug,
    openWalletSwitcher,
  } = useUIStore()
  const { config, load } = useGeoStore()
  const { activeCurrency, fetchWallets, getActiveWallet, setActiveCurrency } = useWalletStore()
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState('')
  const [method, setMethod] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCrypto, setShowCrypto] = useState(false)
  const [mode, setMode] = useState<'fiat' | 'crypto'>('fiat')
  const [ticket, setTicket] = useState<CryptoDepositTicket | null>(null)

  // Валюта пополнения — валюта активного кошелька: «Пополнить» с USDT-кошелька не
  // должен обещать зачисление в рубли (конвертации по ТЗ нет, Don't-лист §6).
  const currency =
    depositCurrency || getActiveWallet()?.currency || config?.activeCurrency || activeCurrency

  useEffect(() => {
    if (depositSheet) {
      void load()
    }
  }, [depositSheet, load])

  useEffect(() => {
    if (!depositSheet) {
      return
    }
    const crypto = isCryptoCurrency(currency)
    setMode(crypto ? 'crypto' : 'fiat')
    setShowCrypto(crypto)
    setTicket(null)
    setAmountError('')
    const first = crypto ? config?.cryptoMethods[0] : config?.paymentMethods[0]
    if (first) {
      setMethod(first.id)
    }
  }, [config, depositSheet, currency])

  const presets = config?.depositPresets ?? ['1000', '2000', '5000', '10000']
  const fiatMethods = config?.paymentMethods ?? []
  const cryptoMethods = config?.cryptoMethods ?? []
  const payCurrency =
    mode === 'crypto' && cryptoMethods[0]
      ? (cryptoMethods.find((m) => m.id === method)?.currency ?? 'USDT_TRC20')
      : currency

  if (!depositSheet && !depositSheetClosing) {
    return null
  }

  const pay = async (): Promise<void> => {
    // Валидация суммы ДО API: пусто/нечисло → подсказка у поля (фидбек был
    // молчаливым return — пользователь не понимал, почему ничего не происходит).
    const amountNum = Number(amount.replace(',', '.').trim())
    if (amount.trim() === '' || Number.isNaN(amountNum) || amountNum <= 0) {
      setAmountError('Выберите или введите сумму пополнения')
      return
    }
    if (mode === 'fiat' && config?.depositMin && amountNum < Number(config.depositMin)) {
      setAmountError(`Минимальная сумма — ${formatAmount(config.depositMin, currency, true)}`)
      return
    }
    if (mode === 'fiat' && config?.depositMax && amountNum > Number(config.depositMax)) {
      setAmountError(`Максимальная сумма — ${formatAmount(config.depositMax, currency, true)}`)
      return
    }
    if (!method) {
      setAmountError('Выберите способ оплаты')
      return
    }
    setAmountError('')
    setLoading(true)
    try {
      if (mode === 'crypto') {
        setTicket(await createCryptoDeposit({ amount, currency: payCurrency }))
        return
      }
      await setActiveCurrency(payCurrency)
      const res = await createFiatDeposit({ amount, currency: payCurrency, method })
      if (res.payment_url) {
        if (res.payment_request_id) {
          saveDepositContext(res.payment_request_id, pendingGameSlug)
        }
        window.location.href = res.payment_url
      } else {
        toast.error('Не получен URL оплаты')
      }
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setLoading(false)
    }
  }

  const openCrypto = (): void => {
    setMode('crypto')
    setShowCrypto(true)
    if (cryptoMethods[0]) {
      setMethod(cryptoMethods[0].id)
    }
  }

  const credited = (): void => {
    setTicket(null)
    closeDeposit()
    void fetchWallets()
    toast.success('Зачислено')
  }

  return (
    <>
      <div
        className={`sheet-backdrop${depositSheetClosing ? ' sheet-backdrop-out' : ''}`}
        onClick={closeDeposit}
      />
      <div className={`sheet-panel${depositSheetClosing ? ' sheet-panel-out' : ''}`}>
        <div className="sheet-handle" />
        <SheetTop
          currency={payCurrency}
          balance={getActiveWallet()?.available ?? '0'}
          onClose={closeDeposit}
          onSwitchWallet={() => {
            closeDeposit()
            openWalletSwitcher()
          }}
        />

        {ticket ? (
          <CryptoDepositTicketPanel ticket={ticket} onCredited={credited} onClose={closeDeposit} />
        ) : (
          <>
            <MethodSection
              mode={mode}
              fiatMethods={fiatMethods}
              cryptoMethods={cryptoMethods}
              method={method}
              showCrypto={showCrypto}
              setMethod={setMethod}
              openCrypto={openCrypto}
              setMode={setMode}
              setShowCrypto={setShowCrypto}
            />

            <AmountField
              currency={payCurrency}
              amount={amount}
              error={amountError}
              onAmount={(value) => {
                setAmount(value)
                setAmountError('')
              }}
              /* Пресеты и минимум отдаёт только для активного фиата
                 (geo-config.policy.ts:51 — CURRENCY_LIMITS[activeCurrency], где
                 activeCurrency всегда фиат). Крипто-шкала на бэке есть, но наружу
                 не выходит, а автоконвертации нет (Don't-лист §6) — значит рублёвые
                 «500 / 1000 / 2000» под подписью USDT были бы враньём. */
              presets={mode === 'fiat' ? presets : []}
              min={mode === 'fiat' ? config?.depositMin : undefined}
            />

            <button
              type="button"
              className="btn-money mt-5 w-full py-3.5 text-base"
              disabled={loading}
              onClick={() => {
                void pay()
              }}
            >
              {loading ? 'Переход к оплате…' : 'Перейти к оплате'}
              {!loading && <ArrowRight size={16} aria-hidden />}
            </button>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
              <ShieldCheck size={14} aria-hidden className="text-money-dark" />
              Платёж защищён · зачисление обычно за 1 минуту
            </p>

            {pendingGameSlug && (
              <p className="mt-2 text-center text-xs text-muted">После оплаты — вернётесь в игру</p>
            )}
          </>
        )}
      </div>
    </>
  )
}
