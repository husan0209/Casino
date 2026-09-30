'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Check, Plus, ShieldCheck, Wallet } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

import { apiGet } from '@/lib/api'
import {
  currencyFullName,
  currencyLabel,
  formatAmount,
  formatBalance,
  networkLabel,
} from '@/lib/format/currency'
import { currencyIconClass } from '@/lib/ui/currency-icon'
import { amountDirection, formatTxAmount, txTypeLabel } from '@/lib/ui/history-filters'
import { splitWalletsByKind } from '@/lib/wallet/helpers'
import { useAuth } from '@/stores/auth'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'
import type { WalletBalance } from '@/types/wallet'
import type { WalletTxDto, WalletTxListDto } from '@/types/wallet-tx'

import { money } from '@casino/shared-utils'

function ActiveWalletCard({
  wallet,
  onDeposit,
  onWithdraw,
}: {
  wallet: WalletBalance
  onDeposit: () => void
  onWithdraw: () => void
}): React.JSX.Element {
  return (
    <div className="relative mb-8 overflow-hidden rounded-3xl border border-[#6C63FF]/40 bg-gradient-to-br from-[#1E1B4B] via-[#161B33] to-[#0F0F1A] p-6 shadow-2xl md:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#6C63FF]/20 blur-3xl"
      />
      <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-[#00C853]" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              Основной игровой счёт
            </span>
          </div>
          <div className="mt-2 text-3xl font-black tracking-tight text-white md:text-5xl">
            {formatBalance(wallet.available, wallet.currency)}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted">
            <span>{currencyFullName(wallet.currency)}</span>
            {Number(wallet.locked) > 0 && (
              <>
                <span>•</span>
                <span>В заявках: {formatAmount(wallet.locked, wallet.currency)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={onDeposit}
            className="btn-money px-5 py-3 text-sm font-bold shadow-lg"
          >
            <Plus size={18} strokeWidth={2.4} />
            Пополнить
          </button>
          <button
            type="button"
            onClick={onWithdraw}
            className="btn-ghost px-5 py-3 text-sm font-bold text-white hover:bg-white/10"
          >
            <ArrowUpRight size={18} />
            Вывести
          </button>
        </div>
      </div>
    </div>
  )
}

function TxRow({ t }: { t: WalletTxDto }): React.JSX.Element {
  const dir = amountDirection(t.amount)
  return (
    <div className="flex items-center justify-between p-4 text-sm transition hover:bg-white/[0.02]">
      <div className="flex items-center gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
            dir === 'in'
              ? 'bg-[#00C853]/10 text-[#00C853]'
              : dir === 'out'
                ? 'bg-[#FF3D71]/10 text-[#FF3D71]'
                : 'bg-white/5 text-muted'
          }`}
        >
          {dir === 'in' ? (
            <ArrowDownLeft size={16} />
          ) : dir === 'out' ? (
            <ArrowUpRight size={16} />
          ) : (
            <Wallet size={16} />
          )}
        </span>
        <div>
          <div className="font-semibold text-white">{txTypeLabel(t.type)}</div>
          <div className="text-xs text-muted">
            {new Date(t.created_at).toLocaleString('ru', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div
          className={`font-bold ${
            dir === 'in' ? 'text-[#00C853]' : dir === 'out' ? 'text-[#FF3D71]' : 'text-muted'
          }`}
        >
          {formatTxAmount(t.amount, t.currency)}
        </div>
        <div className="text-[11px] text-muted">
          Остаток: {formatAmount(t.balance_after, t.currency)}
        </div>
      </div>
    </div>
  )
}

/** Пустую группу не показываем: заголовок без карточек выглядит сломанным. */
const GROUPS = [
  { title: 'ФИАТНЫЕ СЧЕТА', crypto: false },
  { title: 'КРИПТОВАЛЮТНЫЕ СЧЕТА', crypto: true },
] as const

/** Строка кошелька в группе (ТЗ ч.5.1 §5.1): тусклый ноль, у крипты — тег сети. */
function WalletTile({
  wallet,
  isActive,
  withNetwork,
  onPick,
}: {
  wallet: WalletBalance
  isActive: boolean
  withNetwork: boolean
  onPick: () => void
}): React.JSX.Element {
  const empty = !money.isPositive(wallet.available)
  return (
    <button
      type="button"
      onClick={onPick}
      className={`card flex items-center justify-between p-4 text-left transition hover:border-[#6C63FF]/50 ${
        isActive ? 'border-[#6C63FF] bg-[#16213E]/90' : 'bg-[#16213E]/40'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={currencyIconClass(wallet.currency)}>
          {currencyLabel(wallet.currency)}
        </span>
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
            <span>{currencyFullName(wallet.currency)}</span>
            {withNetwork && (
              <span className="rounded bg-[#00D2FF]/10 px-1 py-0.5 text-[9px] font-bold text-[#00D2FF]">
                {networkLabel(wallet.currency)}
              </span>
            )}
          </div>
          <div className={`text-sm font-bold ${empty ? 'text-muted/60' : 'text-white'}`}>
            {formatBalance(wallet.available, wallet.currency)}
          </div>
        </div>
      </div>
      {isActive ? (
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#6C63FF]/20 text-[#6C63FF]">
          <Check size={14} />
        </span>
      ) : (
        <span className="text-xs text-muted hover:text-white">Выбрать</span>
      )}
    </button>
  )
}

export default function WalletPage(): React.JSX.Element {
  const { user } = useAuth()
  const { activeCurrency, setActiveCurrency } = useWalletStore()
  const { config, load } = useGeoStore()
  const { openDeposit, openWithdraw } = useUIStore()

  useEffect(() => {
    void load()
  }, [load])

  const { data: balances } = useQuery({
    queryKey: ['wallet', 'balances'],
    queryFn: () => apiGet<WalletBalance[]>('/wallet/balances'),
    enabled: Boolean(user),
    refetchInterval: 10000,
  })

  const { data: tx } = useQuery({
    queryKey: ['wallet', 'tx', activeCurrency],
    queryFn: () =>
      apiGet<WalletTxListDto>('/wallet/transactions', { per_page: 5, currency: activeCurrency }),
    enabled: Boolean(user),
  })

  if (!user) {
    return <div className="container-1 py-12 text-center text-muted">Войдите в аккаунт</div>
  }

  const walletList = balances ?? []
  const activeWallet = walletList.find((w) => w.currency === activeCurrency) ?? {
    currency: activeCurrency,
    balance: '0',
    locked: '0',
    available: '0',
  }

  // Тот же источник списка, что у шторки: включённые гео-конфигом валюты видны и с нулём.
  const { fiat: fiatWallets, crypto: cryptoWallets } = splitWalletsByKind(walletList, {
    enabledFiat: config?.enabledFiat ?? ['RUB'],
    enabledCrypto: config?.enabledCrypto ?? [],
    activeCurrency,
  })

  return (
    <div className="container-1 py-6 max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="caps-label">УПРАВЛЕНИЕ СРЕДСТВАМИ</p>
          <h1 className="page-title">Мои кошельки</h1>
        </div>
      </div>

      <ActiveWalletCard
        wallet={activeWallet}
        onDeposit={() => openDeposit(activeCurrency)}
        onWithdraw={() => openWithdraw(activeCurrency)}
      />

      <div className="mb-8 space-y-6">
        {GROUPS.map((group) => {
          const list = group.crypto ? cryptoWallets : fiatWallets
          if (list.length === 0) {
            return null
          }
          return (
            <div key={group.title}>
              <p className="caps-label mb-2">{group.title}</p>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {list.map((w) => (
                  <WalletTile
                    key={w.currency}
                    wallet={w}
                    isActive={w.currency === activeCurrency}
                    withNetwork={group.crypto}
                    onPick={() => void setActiveCurrency(w.currency)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="caps-label">ИСТОРИЯ</p>
            <h2 className="section-title">Последние операции</h2>
          </div>
          <Link
            href="/wallet/transactions"
            className="text-xs font-semibold text-brand-light hover:underline"
          >
            Смотреть все →
          </Link>
        </div>

        <div className="card overflow-hidden p-0">
          <div className="divide-y divide-[#2A2A4A]/50">
            {(tx?.data ?? []).map((t) => (
              <TxRow key={t.id} t={t} />
            ))}
            {(!tx?.data || tx.data.length === 0) && (
              <div className="p-8 text-center text-sm text-muted">Транзакций пока нет</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 text-center text-xs text-muted/80">
        <ShieldCheck size={16} className="text-[#00C853]" />
        <span>Отдельные балансы. Без скрытой конвертации и комиссий.</span>
      </div>
    </div>
  )
}
