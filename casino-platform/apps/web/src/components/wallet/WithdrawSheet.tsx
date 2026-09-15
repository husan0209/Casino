'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { errCode, errText } from '@/lib/api'
import { getKycStatus } from '@/lib/api/kyc.api'
import { createCryptoWithdrawal, createFiatWithdrawal } from '@/lib/api/wallet.api'
import { currencyLabel, formatAmount } from '@/lib/format/currency'
import {
  checkWithdrawAmount,
  isCryptoCurrency,
  fiatMethodLabel,
  limitsFor,
  maskDestination,
  networkLabel,
  normalizeDestination,
  resolveWithdrawPrecheck,
  validateDestination,
  withdrawPresets,
  type WithdrawMethod,
  type WithdrawPrecheck,
} from '@/lib/ui/withdraw'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

/**
 * GAP-55 (з) (ТЗ ч.5 §10.3/§16.1): WithdrawSheet — глобальный лист вывода,
 * смонтирован в корневом layout, открывается и из кошелька, и поверх игры.
 *
 * §10.3 соблюдён через resolveWithdrawPrecheck: KYC-стопер (без формы вообще) →
 * «ечего выводить» → предложить валюту с деньгами → форма. Форма выводит только
 * в валюте выбранного кошелька и только на метод этой валюты (методы — из
 * GeoConfig, не из воздуха); сеть крипты не меняется и видна всегда (§2.7).
 * Перед заявкой — подтверждение с ЗАМАСКИРОВАННЫМИ реквизитами; на сервер уходит
 * настоящее значение (маска — только для экрана).
 */
type Stage = 'form' | 'confirm' | 'done'

const FALLBACK_FIAT_METHODS: { id: WithdrawMethod; label: string }[] = [
  { id: 'card', label: 'Карта' },
  { id: 'sbp', label: 'СБП' },
]

export function WithdrawSheet(): React.JSX.Element | null {
  const { withdrawSheet, closeWithdraw, openWithdraw, withdrawCurrency, openDeposit, openWalletSwitcher } =
    useUIStore()
  const { wallets, activeCurrency, fetchWallets, refreshActive } = useWalletStore()
  const { config, load } = useGeoStore()
  const { user } = useAuth()
  const router = useRouter()

  const [stage, setStage] = useState<Stage>('form')
  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState('')
  const [method, setMethod] = useState<WithdrawMethod>('card')
  const [problem, setProblem] = useState<string | null>(null)
  const [requestId, setRequestId] = useState('')

  const currency = withdrawCurrency ?? activeCurrency
  const crypto = isCryptoCurrency(currency)

  useEffect(() => {
    if (!withdrawSheet) {
      return
    }
    void load()
    void fetchWallets()
    setStage('form')
    setAmount('')
    setDestination('')
    setProblem(null)
    setRequestId('')
  }, [withdrawSheet, load, fetchWallets])

  const { data: kyc } = useQuery({
    queryKey: ['kyc-status', currency],
    queryFn: () => getKycStatus(currency),
    enabled: withdrawSheet && Boolean(user),
  })

  const precheck = resolveWithdrawPrecheck({
    kycApproved: kyc?.status === 'approved',
    activeCurrency: currency,
    wallets,
  })

  const available =
    precheck.kind === 'form'
      ? precheck.available
      : (wallets.find((wallet) => wallet.currency === currency)?.available ?? '0')

  const submit = useMutation({
    mutationFn: () => {
      const clean = normalizeDestination({ currency, method, value: destination })
      return crypto
        ? createCryptoWithdrawal({ amount, currency, destination: clean })
        : createFiatWithdrawal({ amount, method, destination: clean })
    },
    onSuccess: (result) => {
      setRequestId(result.payment_request_id)
      setStage('done')
      void refreshActive()
      toast.success('Заявка создана, средства заблокированы')
    },
    onError: (error: unknown) => {
      // Гейт всё же на бэке: если KYC «протёк» из кеша — ведём на верификацию, а не показываем 422
      if (errCode(error) === 'KYC_REQUIRED') {
        closeWithdraw()
        router.push('/kyc')
        return
      }
      toast.error(errText(error) || 'Не удалось создать заявку')
    },
  })

  if (!withdrawSheet) {
    return null
  }

  if (precheck.kind !== 'form' && stage !== 'done') {
    return (
      <SheetShell onClose={closeWithdraw}>
        <WithdrawPrecheckPanel
          precheck={precheck}
          currency={currency}
          onKyc={() => {
            closeWithdraw()
            router.push('/kyc')
          }}
          onDeposit={openDeposit}
          onSwitchTo={openWithdraw}
        />
      </SheetShell>
    )
  }

  const limits = limitsFor(currency)
  const fiatMethods = fiatMethodsFor(config?.paymentMethods, currency)

  const goConfirm = (): void => {
    const amountCheck = checkWithdrawAmount({ amount, currency, available })
    if (!amountCheck.ok) {
      setProblem(amountProblemText(amountCheck.reason, currency, limits))
      return
    }
    const destinationProblem = crypto
      ? validateDestination({ currency, value: destination })
      : validateDestination({ currency, method, value: destination })
    if (destinationProblem) {
      setProblem(destinationProblem)
      return
    }
    setProblem(null)
    setStage('confirm')
  }

  return (
    <SheetShell onClose={closeWithdraw}>
        {stage === 'done' && (
          <DonePanel
            requestId={requestId}
            amountLabel={formatAmount(amount, currency)}
            onHistory={() => {
              closeWithdraw()
              router.push('/wallet')
            }}
            onClose={closeWithdraw}
          />
        )}

        {stage === 'confirm' && (
          <ConfirmPanel
            amountLabel={formatAmount(amount, currency)}
            destinationMask={maskDestination({ currency, method: crypto ? undefined : method, value: destination })}
            methodLabel={crypto ? `Крипта · ${networkLabel(currency)}` : (fiatMethods.find((m) => m.id === method)?.label ?? fiatMethodLabel(method))}
            pending={submit.isPending}
            onBack={() => setStage('form')}
            onSubmit={() => submit.mutate()}
          />
        )}

        {stage === 'form' && (
          <WithdrawForm
            currency={currency}
            crypto={crypto}
            available={available}
            fiatMethods={fiatMethods}
            method={method}
            amount={amount}
            destination={destination}
            problem={problem}
            onMethodChange={setMethod}
            onAmountChange={setAmount}
            onDestinationChange={setDestination}
            onSwitchWallet={openWalletSwitcher}
            onSubmit={goConfirm}
          />
        )}
    </SheetShell>
  )
}

/** Методы вывода этой валюты из гео-конфига; API принимает card|sbp. */
function fiatMethodsFor(
  methods: { id: string; label: string; currency: string; type: string }[] | undefined,
  currency: string,
): { id: WithdrawMethod; label: string }[] {
  const allowed = new Set<string>(['card', 'sbp'])
  const fromConfig = (methods ?? [])
    .filter((item) => item.currency === currency && allowed.has(item.id))
    .map((item) => ({ id: item.id as WithdrawMethod, label: item.label }))
  if (fromConfig.length > 0) {
    return fromConfig
  }
  return currency === 'RUB' ? [...FALLBACK_FIAT_METHODS] : []
}

function amountProblemText(
  reason: 'format' | 'min' | 'max' | 'insufficient' | undefined,
  currency: string,
  limits: { min: string; max: string },
): string {
  if (reason === 'min') {
    return `Минимум для вывода — ${formatAmount(limits.min, currency)}`
  }
  if (reason === 'max') {
    return `Максимум в одной заявке — ${formatAmount(limits.max, currency)}`
  }
  if (reason === 'insufficient') {
    return 'Не хватает доступного остатка'
  }
  return 'Введите сумму числом'
}


/**
 * Стадия «форма»: кошелёк/сеть, способы (только этой валюты, §10.3), сумма с
 * пресетами и минимумом, реквизиты с предупреждением сети. Логика проверок —
 * в lib/ui/withdraw, здесь только разметка и поднятие состояния.
 */
function WithdrawForm({
  currency,
  crypto,
  available,
  fiatMethods,
  method,
  amount,
  destination,
  problem,
  onMethodChange,
  onAmountChange,
  onDestinationChange,
  onSwitchWallet,
  onSubmit,
}: {
  currency: string
  crypto: boolean
  available: string
  fiatMethods: { id: WithdrawMethod; label: string }[]
  method: WithdrawMethod
  amount: string
  destination: string
  problem: string | null
  onMethodChange: (method: WithdrawMethod) => void
  onAmountChange: (amount: string) => void
  onDestinationChange: (destination: string) => void
  onSwitchWallet: () => void
  onSubmit: () => void
}): React.JSX.Element {
  const limits = limitsFor(currency)
  const presets = withdrawPresets(currency)

  return (
<div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">
                Кошелёк: {currencyLabel(currency)}
                {crypto && ` · сеть ${networkLabel(currency)}`}
              </span>
              <button type="button" className="text-[#6C63FF]" onClick={onSwitchWallet}>
                сменить
              </button>
            </div>
            <div className="text-2xl font-bold">{formatAmount(available, currency)}</div>

            {!crypto && (
              <div className="flex gap-2">
                {fiatMethods.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onMethodChange(item.id)}
                    className={`rounded-xl px-3 py-1.5 text-xs ${
                      method === item.id ? 'bg-[#6C63FF] text-white' : 'text-muted hover:bg-white/5'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <div>
              <input
                className="input"
                inputMode="decimal"
                placeholder="Сумма"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                aria-label="Сумма вывода"
              />
              {presets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="btn-ghost px-3 py-1.5 text-xs"
                      onClick={() => onAmountChange(preset)}
                    >
                      {formatAmount(preset, currency)}
                    </button>
                  ))}
                </div>
              )}
              {/* суммы всегда с символом валюты (§2.5: голое число = ошибка) */}
              <div className="mt-2 text-xs text-muted">
                Минимум {formatAmount(limits.min, currency)} · зачисление до 24 часов
              </div>
            </div>

            <div>
              <input
                className="input"
                autoComplete="off"
                placeholder={crypto ? 'Адрес кошелька' : (method === 'sbp' ? 'Телефон из реестра' : 'Номер карты')}
                value={destination}
                onChange={(e) => onDestinationChange(e.target.value)}
                aria-label="Реквизиты для вывода"
              />
              {crypto && (
                <p className="mt-2 text-xs text-[#FFB300]">
                  Отправляйте только {currencyLabel(currency)} в сети {networkLabel(currency)}; другая сеть или валюта —
                  потеря средств.
                </p>
              )}
            </div>

            {problem && <p className="text-sm text-[#FF3D71]">{problem}</p>}

            <button
              type="button"
              className="btn w-full"
              disabled={amount.length === 0 || destination.length === 0}
              onClick={onSubmit}
            >
              Продолжить
            </button>
          </div>
  )
}

/**
 * §10.3 «проверки до формы»: KYC-стопер, «ечего выводить», предложить другую
 * валюту. Никакой формы реквизитов здесь быть не должно — только одно
 * следующее действие на каждый случай.
 */
function WithdrawPrecheckPanel({
  precheck,
  currency,
  onKyc,
  onDeposit,
  onSwitchTo,
}: {
  precheck: WithdrawPrecheck
  currency: string
  onKyc: () => void
  onDeposit: (currency: string) => void
  onSwitchTo: (currency: string) => void
}): React.JSX.Element {
  if (precheck.kind === 'kyc_required') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Вывод доступен после верификации — это одно действие, форма сама откроется следом.
        </p>
        <button type="button" className="btn w-full" onClick={onKyc}>
          Пройти верификацию
        </button>
      </div>
    )
  }
  if (precheck.kind === 'nothing_to_withdraw') {
    return (
      <div className="space-y-4">
        <p className="text-sm">Нечего выводить — кошельки пустые.</p>
        <button type="button" className="btn-money w-full" onClick={() => onDeposit(currency)}>
          Пополнить {currencyLabel(currency)}
        </button>
      </div>
    )
  }
  if (precheck.kind === 'suggest_currency') {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          В {currencyLabel(precheck.from)} пусто. Вывести {formatAmount(precheck.amount, precheck.to)}?
        </p>
        <button type="button" className="btn w-full" onClick={() => onSwitchTo(precheck.to)}>
          Вывести в {currencyLabel(precheck.to)}
        </button>
        <button type="button" className="btn-ghost w-full" onClick={() => onDeposit(precheck.from)}>
          Пополнить {currencyLabel(precheck.from)}
        </button>
      </div>
    )
  }
  return <div className="space-y-4" />
}

/** Оболочка листа: затемнение + нижняя панель + заголовок (одна на все стадии). */
function SheetShell({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet-panel">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Вывод средств</h2>
          <button type="button" onClick={onClose} className="text-muted" aria-label="Закрыть">
            ✕
          </button>
        </div>
        {children}
      </div>
    </>
  )
}

function ConfirmPanel({
  amountLabel,
  destinationMask,
  methodLabel,
  pending,
  onBack,
  onSubmit,
}: {
  amountLabel: string
  destinationMask: string
  methodLabel: string
  pending: boolean
  onBack: () => void
  onSubmit: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="card space-y-2 text-sm">
        <Row label="Сумма" value={amountLabel} />
        <Row label="Способ" value={methodLabel} />
        <Row label="Реквизиты" value={destinationMask} />
        <Row label="Срок" value="до 24 часов" />
      </div>
      <p className="text-xs text-muted">
        Реквизиты на подтверждении показаны частично. Сумма замораживается на кошельке до решения
        администратора.
      </p>
      <button type="button" className="btn-money w-full" disabled={pending} onClick={onSubmit}>
        {pending ? 'Создание…' : 'Подтвердить вывод'}
      </button>
      <button type="button" className="btn-ghost w-full" onClick={onBack}>
        Назад
      </button>
    </div>
  )
}

function DonePanel({
  requestId,
  amountLabel,
  onHistory,
  onClose,
}: {
  requestId: string
  amountLabel: string
  onHistory: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Заявка <span className="font-mono">{requestId.slice(0, 8)}</span> создана, {amountLabel} заморожены.
        Статус — в кошельке.
      </p>
      <button type="button" className="btn w-full" onClick={onHistory}>
        История
      </button>
      <button type="button" className="btn-ghost w-full" onClick={onClose}>
        Закрыть
      </button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
