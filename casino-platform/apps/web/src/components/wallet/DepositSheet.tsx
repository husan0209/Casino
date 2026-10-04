'use client'
import { useQuery } from '@tanstack/react-query'
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
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { CurrencyIcon } from '@/components/ui/CurrencyIcon'
import { toast } from '@/components/ui/toaster'
import { CryptoDepositTicketPanel } from '@/components/wallet/CryptoDepositTicket'
import { saveDepositContext } from '@/components/wallet/DepositReturnHandler'
import { errText } from '@/lib/api'
import { getKycStatus } from '@/lib/api/kyc.api'
import {
  createCryptoDeposit,
  createFiatDeposit,
  type CryptoDepositTicket,
} from '@/lib/api/wallet.api'
import { currencyLabel, formatAmount, isCryptoCurrency } from '@/lib/format/currency'
import { useAuth } from '@/stores/auth'
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
}: {
  currency: string
  amount: string
  onAmount: (value: string) => void
  presets: string[]
  min: string | undefined
}): React.JSX.Element {
  return (
    <div className="mt-4">
      <label className="text-sm text-muted">Сумма, {currencyLabel(currency)}</label>
      <input
        className="input mt-1"
        value={amount}
        onChange={(e) => onAmount(e.target.value)}
        /* Фиатная подсказка «2000» в поле USDT — тот же обман масштаба, из-за
           которого пресеты в крипто-кассе убраны. */
        placeholder={isCryptoCurrency(currency) ? '0.00' : '2000'}
      />
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
  const { depositSheet, closeDeposit, depositCurrency, pendingGameSlug, openWalletSwitcher } =
    useUIStore()
  const { config, load } = useGeoStore()
  const { activeCurrency, fetchWallets, getActiveWallet, setActiveCurrency } = useWalletStore()
  const { user } = useAuth()
  const router = useRouter()
  const [amount, setAmount] = useState('')
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

  const { data: kyc } = useQuery({
    queryKey: ['kyc-status', payCurrency],
    queryFn: () => getKycStatus(payCurrency),
    enabled: Boolean(depositSheet) && Boolean(user),
  })

  if (!depositSheet) {
    return null
  }

  const kycNotApproved = Boolean(kyc) && kyc?.status !== 'approved'
  const limitRemaining = kyc?.limit_remaining
  const limitExhausted =
    kycNotApproved && limitRemaining !== undefined && Number(limitRemaining) <= 0

  const pay = async (): Promise<void> => {
    if (!amount || !method) {
      return
    }
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
      <div className="sheet-backdrop" onClick={closeDeposit} />
      <div className="sheet-panel">
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
              onAmount={setAmount}
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
                if (limitExhausted) {
                  closeDeposit()
                  router.push('/kyc')
                  return
                }
                void pay()
              }}
            >
              {loading
                ? 'Переход к оплате…'
                : limitExhausted
                  ? 'Лимит исчерпан — пройти верификацию'
                  : 'Перейти к оплате'}
              {!loading && !limitExhausted && <ArrowRight size={16} aria-hidden />}
            </button>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
              <ShieldCheck size={14} aria-hidden className="text-money-dark" />
              Платёж защищён · зачисление обычно за 1 минуту
            </p>

            {kycNotApproved && limitRemaining !== undefined && !limitExhausted && (
              <p className="mt-2 text-center text-xs text-muted">
                Без верификации можно выводить до{' '}
                {formatAmount(limitRemaining, kyc?.limit_currency ?? '', true)}
              </p>
            )}

            {pendingGameSlug && (
              <p className="mt-2 text-center text-xs text-muted">После оплаты — вернётесь в игру</p>
            )}
          </>
        )}
      </div>
    </>
  )
}
