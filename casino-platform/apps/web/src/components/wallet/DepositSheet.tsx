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
import { errCode, errText } from '@/lib/api'
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
/** Пауза перед новой попыткой после отказа провайдера (см. `retryAfter`). */
const PROVIDER_RETRY_COOLDOWN_S = 60

/**
 * Игрок получает вывод и следующий шаг, а не строку от RuKassa: у «счёт
 * приостановлен» и «такого способа нет» разные действия, и путать их нельзя —
 * в первом случае повторные клики только закапывают аккаунт глубже.
 */
const PROVIDER_REFUSAL_TEXT: Record<string, string> = {
  PAYMENT_PROVIDER_ACCOUNT_FROZEN:
    'Платёжная система приостановила операции по вашему счёту. Деньги не списаны. Напишите в поддержку — разберёмся.',
  PAYMENT_PROVIDER_METHOD_UNAVAILABLE:
    'Этот способ оплаты сейчас недоступен. Выберите другой или попробуйте позже.',
  PAYMENT_PROVIDER_ERROR:
    'Платёжная система отклонила платёж. Деньги не списаны — попробуйте другой способ или позже.',
}

/**
 * Отказ НЕ провайдера, а наш: суточный самолимит на неоплаченные заявки.
 * Кулдаун сюда не навешиваем — блокировка до полуночи, «повтори через минуту»
 * было бы ложным обещанием.
 */
const LOCAL_LIMIT_TEXT: Record<string, string> = {
  FIAT_DEPOSIT_ATTEMPT_LIMIT:
    'Ты несколько раз не завершил оплату — пополнение рублями доступно снова завтра после 00:00. Нужно сейчас: USDT TRC20 или BTC.',
}

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
  // RuKassa держит «клиента» по нашему user_code и замораживает его после серии
  // отказов — навсегда, размораживает только поддержка. Значит второй клик по той
  // же кнопке стоит игроку аккаунта: после отказа провайдера даём новую попытку не
  // сразу, а с паузой.
  const [retryAfter, setRetryAfter] = useState(0)
  const [, forceTick] = useState(0)
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

  // Обратный отсчёт живёт на тиках, а не на дедлайне в тексте: без перерисовки
  // кнопка так и показала бы «через 60 с», когда уже можно пробовать.
  useEffect(() => {
    if (retryAfter <= Date.now()) {
      return
    }
    const timer = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => {
      clearInterval(timer)
    }
  }, [retryAfter])

  const cooldownLeft = Math.max(0, Math.ceil((retryAfter - Date.now()) / 1000))

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
      // Отказ платёжной системы приходит английским «Rukassa error» /
      // «NOWPayments error»: игроку оно не говорит ничего, а внутренности PSP
      // наружу и не должны. Смысл один — деньги не списаны, это не тупик.
      const code = errCode(e)
      const refusal = code ? PROVIDER_REFUSAL_TEXT[code] : undefined
      const localLimit = code ? LOCAL_LIMIT_TEXT[code] : undefined
      toast.error(refusal ?? localLimit ?? (errText(e) || 'Не удалось пополнить'))
      if (refusal) {
        setRetryAfter(Date.now() + PROVIDER_RETRY_COOLDOWN_S * 1000)
      }
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
              disabled={loading || cooldownLeft > 0}
              onClick={() => {
                void pay()
              }}
            >
              {loading
                ? 'Переход к оплате…'
                : cooldownLeft > 0
                  ? `Повторить через ${cooldownLeft} с`
                  : 'Перейти к оплате'}
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
