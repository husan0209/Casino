/**
 * Цветные кружки валют: одна таблица на шторку кошельков и страницу «Мои кошельки».
 * Волна 5.1 (остаток): в main пока две инлайновые копии этой таблицы
 * (wallet/page.tsx, WalletSwitcher.tsx) — заменить их на импорт = отдельный шаг.
 */
const ICON_CLASS: Record<string, string> = {
  RUB: 'currency-icon currency-icon-rub',
  KZT: 'currency-icon currency-icon-kzt',
  UAH: 'currency-icon currency-icon-uah',
  BYN: 'currency-icon currency-icon-byn',
  UZS: 'currency-icon currency-icon-uzs',
  USDT_TRC20: 'currency-icon currency-icon-usdt',
  BTC: 'currency-icon currency-icon-btc',
}

export function currencyIconClass(currency: string): string {
  return ICON_CLASS[currency] ?? 'currency-icon bg-white/[0.06] text-white'
}
