'use client'

import { Check, Plus, X } from 'lucide-react'
import { useEffect } from 'react'

import { CurrencyIcon } from '@/components/ui/CurrencyIcon'
import {
  currencyFullName,
  formatBalance,
  isCryptoCurrency,
  networkLabel,
} from '@/lib/format/currency'
import { mergeWallets, sortWallets } from '@/lib/wallet/helpers'
import { useGeoStore } from '@/stores/geo'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'
import type { WalletBalance } from '@/types/wallet'

import { money } from '@casino/shared-utils'

/** Одна строка кошелька: цветная иконка, название, тег сети (крипта), баланс; нули — тусклые. */
function WalletRow({
  wallet,
  active,
  onPick,
}: {
  wallet: WalletBalance
  active: boolean
  onPick: (currency: string) => void
}): React.JSX.Element {
  const empty = !money.isPositive(wallet.available)

  return (
    <button
      type="button"
      onClick={() => onPick(wallet.currency)}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition ${
        active
          ? 'border-[#6C63FF] bg-white/[0.04]'
          : 'border-transparent hover:border-[#2A2A4A] hover:bg-white/[0.03]'
      } ${empty ? 'text-muted' : 'text-white'}`}
    >
      <CurrencyIcon currency={wallet.currency} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{currencyFullName(wallet.currency)}</span>
        {isCryptoCurrency(wallet.currency) && (
          <span className="inline-block rounded-md bg-[#00D2FF]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#00D2FF]">
            {networkLabel(wallet.currency)}
          </span>
        )}
      </span>
      <span className={`shrink-0 font-bold ${empty ? 'text-muted/70' : ''}`}>
        {formatBalance(wallet.available, wallet.currency)}
      </span>
      {active && <Check size={18} aria-hidden className="shrink-0 text-[#6C63FF]" />}
    </button>
  )
}

/**
 * Шторка кошельков (ТЗ ч.5.1 §4.1, донор spinera): группы Фиат → Крипта,
 * активный первым с фиолетовой рамкой и чеком, нули тусклые но видимые,
 * бирюзовые теги сетей у крипты, внизу мягкая зелёная «+ Пополнить активный
 * кошелёк». Суммы «итого ≈» нет (§2 пр.6, Don't-лист).
 */
export function WalletSwitcher(): React.JSX.Element | null {
  const { walletSwitcher, walletSwitcherClosing, closeWalletSwitcher, openDeposit } = useUIStore()
  const { wallets, activeCurrency, fetchWallets, setActiveCurrency } = useWalletStore()
  const { config, load } = useGeoStore()

  useEffect(() => {
    if (walletSwitcher) {
      void load()
      void fetchWallets()
    }
  }, [walletSwitcher, load, fetchWallets])

  if (!walletSwitcher && !walletSwitcherClosing) {
    return null
  }

  const fiatEnabled = config?.enabledFiat ?? ['RUB']
  const cryptoEnabled = config?.enabledCrypto ?? []
  const fiat = sortWallets(mergeWallets(wallets, fiatEnabled), activeCurrency)
  const crypto = sortWallets(mergeWallets(wallets, cryptoEnabled), activeCurrency)

  const pick = async (currency: string): Promise<void> => {
    await setActiveCurrency(currency)
    closeWalletSwitcher()
  }

  const group = (label: string, list: WalletBalance[]): React.JSX.Element | null =>
    list.length === 0 ? null : (
      <div>
        <p className="caps-label mt-4 first:mt-0">{label}</p>
        <div className="mt-1 space-y-1">
          {list.map((wallet) => (
            <WalletRow
              key={wallet.currency}
              wallet={wallet}
              active={wallet.currency === activeCurrency}
              onPick={(currency) => void pick(currency)}
            />
          ))}
        </div>
      </div>
    )

  return (
    <>
      <div
        className={`sheet-backdrop${walletSwitcherClosing ? ' sheet-backdrop-out' : ''}`}
        onClick={closeWalletSwitcher}
      />
      <div className={`sheet-panel${walletSwitcherClosing ? ' sheet-panel-out' : ''}`}>
        <div className="sheet-handle" />
        <div className="flex items-center justify-between">
          <div>
            <p className="caps-label">УПРАВЛЕНИЕ БАЛАНСОМ</p>
            <h2 className="text-lg font-bold">Мои кошельки</h2>
          </div>
          <button
            type="button"
            onClick={closeWalletSwitcher}
            aria-label="Закрыть"
            className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-white"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {group('ФИАТ', fiat)}
        {group('КРИПТА', crypto)}

        <button
          type="button"
          className="btn-money mt-5 w-full"
          onClick={() => {
            closeWalletSwitcher()
            openDeposit(activeCurrency)
          }}
        >
          <Plus size={18} aria-hidden />
          Пополнить активный кошелёк
        </button>
      </div>
    </>
  )
}
