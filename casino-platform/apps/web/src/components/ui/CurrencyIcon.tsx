import { currencyLabel, isCryptoCurrency } from '@/lib/format/currency'

/** Официальные логотипы крипты (набор cryptocurrency-icons, CC0) в public/currency. */
const CRYPTO_SLUGS: Record<string, string> = {
  USDT_TRC20: 'usdt',
  BTC: 'btc',
}

const FIAT_CLASSES: Record<string, string> = {
  RUB: 'currency-icon-rub',
  KZT: 'currency-icon-kzt',
  UAH: 'currency-icon-uah',
  BYN: 'currency-icon-byn',
  UZS: 'currency-icon-uzs',
}

function fiatIconClass(currency: string): string {
  return FIAT_CLASSES[currency] ?? 'bg-white/[0.06] text-white'
}

/**
 * Иконка валюты: для крипты — настоящий логотип монеты (цветной кружок
 * из официального набора, читается в любом размере), для фиата — глиф
 * официального символа (₽ ₸ ₴ Br) в брендированном кружке.
 */
export function CurrencyIcon({
  currency,
  size = 40,
  className = '',
}: {
  currency: string
  size?: number
  className?: string
}): React.JSX.Element {
  const slug = CRYPTO_SLUGS[currency] ?? (isCryptoCurrency(currency) ? currency.toLowerCase().split('_')[0] : null)

  if (slug) {
    return (
      <img
        src={`/currency/${slug}.svg`}
        alt={currencyLabel(currency)}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`shrink-0 select-none ${className}`}
        draggable={false}
      />
    )
  }

  return (
    <span
      className={`currency-icon ${fiatIconClass(currency)} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.32)) }}
    >
      {currencyLabel(currency)}
    </span>
  )
}
