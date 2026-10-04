import { type CryptoCurrency } from '@casino/shared-config'

import { InvalidCurrencyError } from './errors'

/**
 * Релизный набор криптовалют платежа (TZ-02).
 *
 * Источник истины — тип `CryptoCurrency` из `@casino/shared-config`
 * (packages/shared-config/src/geo.config.ts:3): в релиз вошли ТОЛЬКО
 * `USDT_TRC20` и `BTC`, валюты `TON`/`TRX`/`LTC` из релиза убраны. Таблица
 * тикеров объявлена как `Record<CryptoCurrency, string>`, поэтому union покрыт
 * целиком на этапе компиляции: ветка маппинга «на валюту будущего» не может
 * появиться раньше, чем валюта появится в гео-конфиге, — мёртвых строк больше
 * нет ни при каком развитии набора.
 *
 * Набор НЕ расширяется через env: `envSchema`
 * (packages/shared-config/src/env.validation.ts) ключей выбора валют не
 * содержит, а справочник методов (`cryptoMethods()`) отдавает те же две
 * позиции. То есть TON/TRX/LTC — не сознательный запас, а расхождение, и
 * отклонение такой валюты — корректное поведение, а не потеря фичи.
 *
 * Регистр значим: внутренние коды — `UPPER_SNAKE`, сравнение точное. Строка
 * `'usdttrc20'` или `'btc'` — это не «та же валюта в другом регистре», а
 * неизвестный вход: ниже по потоку из неё собирался бы `pay_currency` провайдеру.
 */

/** Тикеры NOWPayments для релизных валют (`pay_currency`, `currency_from/to`). */
export const CRYPTO_PAY_CURRENCY_TICKERS: Record<CryptoCurrency, string> = {
  USDT_TRC20: 'usdttrc20',
  BTC: 'btc',
}

/**
 * Тот же набор списком: нужен и домену (проверка/отклонение), и presentation
 * (enum в DTO), чтобы второй whitelist не разъезжался с первым. Приведение к
 * non-empty tuple — требование сигнатуры `z.enum`, ключи `Object.keys` непусты
 * по построению: union `CryptoCurrency` непустой.
 */
export const RELEASE_CRYPTO_CURRENCIES = Object.keys(CRYPTO_PAY_CURRENCY_TICKERS) as [
  CryptoCurrency,
  ...CryptoCurrency[],
]

export function isReleaseCryptoCurrency(currency: string): currency is CryptoCurrency {
  return Object.prototype.hasOwnProperty.call(CRYPTO_PAY_CURRENCY_TICKERS, currency)
}

/**
 * Отклоняет валюту вне релизного набора стабильным `INVALID_CURRENCY` (422).
 * Вызывается ДО любого обращения к провайдеру (use-case и клиент — оба), чтобы
 * заявка в неподдерживаемой валюте не создавалась даже в dev-stub.
 * Вход в контекст ошибки кладём обрезанным — сообщение уходит наружу.
 */
export function assertReleaseCryptoCurrency(currency: string): CryptoCurrency {
  if (!isReleaseCryptoCurrency(currency)) {
    const safeCurrency = currency.slice(0, 32)
    throw new InvalidCurrencyError(`Currency ${safeCurrency} is not enabled for payments`, {
      currency: safeCurrency,
    })
  }
  return currency
}
