'use client'
import { currencyLabel, formatBalance } from '@/lib/format/currency'
import { useUIStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'

export function LaunchCurrencySheet(): React.JSX.Element | null {
  const { launchCurrencySheet, launchCurrencyOptions, closeLaunchCurrency, openDeposit } =
    useUIStore()
  const { setActiveCurrency } = useWalletStore()

  if (!launchCurrencySheet || !launchCurrencyOptions) {
    return null
  }

  const { activeCurrency, targetCurrency, targetAmount, slug, onPlayInTarget } =
    launchCurrencyOptions

  const playInTarget = async (): Promise<void> => {
    await setActiveCurrency(targetCurrency)
    closeLaunchCurrency()
    onPlayInTarget?.()
  }

  const topUp = (): void => {
    closeLaunchCurrency()
    openDeposit(activeCurrency)
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={closeLaunchCurrency} />
      <div className="sheet-panel">
        <h2 className="text-lg font-semibold">
          В {currencyLabel(activeCurrency)} пусто
        </h2>
        <p className="mt-2 text-sm text-muted">
          Играть с {formatBalance(targetAmount, targetCurrency)}?
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" className="btn w-full" onClick={playInTarget}>
            Играть в {currencyLabel(targetCurrency)}
          </button>
          <button type="button" className="btn-money w-full" onClick={topUp}>
            Пополнить{' '}
            {currencyLabel(activeCurrency)}
          </button>
        </div>
        {slug && <p className="mt-3 text-center text-xs text-muted">Игра: {slug}</p>}
      </div>
    </>
  )
}
