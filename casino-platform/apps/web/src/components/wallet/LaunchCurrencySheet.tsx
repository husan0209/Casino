'use client'
import { formatBalance, formatAmount } from '@/lib/format/currency'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

export function LaunchCurrencySheet() {
  const { launchCurrencySheet, launchCurrencyOptions, closeLaunchCurrency, openDeposit } =
    useUIStore()
  const { setActiveCurrency } = useWalletStore()

  if (!launchCurrencySheet || !launchCurrencyOptions) {
    return null
  }

  const { activeCurrency, targetCurrency, targetAmount, slug, onPlayInTarget } =
    launchCurrencyOptions

  const playInTarget = async () => {
    await setActiveCurrency(targetCurrency)
    closeLaunchCurrency()
    onPlayInTarget?.()
  }

  const topUp = () => {
    closeLaunchCurrency()
    openDeposit(activeCurrency)
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={closeLaunchCurrency} />
      <div className="sheet-panel">
        <h2 className="text-lg font-semibold">
          В {formatAmount(0, activeCurrency).replace(/^0\s?/, '').trim() || activeCurrency} пусто
        </h2>
        <p className="mt-2 text-sm text-muted">
          Играть с {formatBalance(targetAmount, targetCurrency)}?
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" className="btn w-full" onClick={playInTarget}>
            Играть в {targetCurrency === 'USDT_TRC20' ? 'USDT' : targetCurrency}
          </button>
          <button type="button" className="btn-money w-full" onClick={topUp}>
            Пополнить{' '}
            {formatAmount(0, activeCurrency).replace(/^0\s?/, '').trim() || activeCurrency}
          </button>
        </div>
        {slug && <p className="mt-3 text-center text-xs text-muted">Игра: {slug}</p>}
      </div>
    </>
  )
}
