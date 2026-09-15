/**
 * GAP-55 (г),(д): юнит-тесты фильтров историй (ТЗ §11/§12).
 * Проверяют то, что типы не ловят: пустые значения не проттекают в API/URL,
 * кривые даты игнорируются (а не дают 500), знак и валюта в сумме (§11
 * «+1 000 без валюты — ошибка UI»), агрегаты не суммируют разные валюты (§12).
 */
import { describe, expect, it } from 'vitest'

import {
  amountDirection,
  betApiParams,
  betHref,
  EMPTY_TX_FILTER,
  formatTxAmount,
  hasActiveBetParts,
  hasActiveTxParts,
  lockedAmountOf,
  metadataField,
  networkOf,
  parseBetFilter,
  parseTxFilter,
  readDateRange,
  statsForCurrency,
  totalRounds,
  txApiParams,
  txHref,
  txTypeLabel,
} from '../src/lib/ui/history-filters'

describe('GAP-55 период (§11/§12)', () => {
  it('принимает только YYYY-MM-DD', () => {
    expect(readDateRange(new URLSearchParams('from=2026-09-01&to=2026-09-07'))).toEqual({
      from: '2026-09-01',
      to: '2026-09-07',
    })
    expect(readDateRange(new URLSearchParams('from=вчера&to=07.09.2026'))).toEqual({ from: '', to: '' })
  })
})

describe('GAP-55 фильтры транзакций (§11)', () => {
  it('парсит type/currency/период', () => {
    const filter = parseTxFilter(new URLSearchParams('type=BET&currency=RUB&from=2026-09-01'))
    expect(filter).toEqual({ type: 'BET', currency: 'RUB', from: '2026-09-01', to: '' })
  })

  it('пустые значения не уходят в API (иначе фильтр «все» станет фильтром "")', () => {
    expect(txApiParams(EMPTY_TX_FILTER)).toEqual({})
    expect(txApiParams({ ...EMPTY_TX_FILTER, type: 'WIN' })).toEqual({ type: 'WIN' })
  })

  it('ссылка: чистая без фильтров, кодированная с ними, page=1 не пишется', () => {
    expect(txHref(EMPTY_TX_FILTER)).toBe('/wallet/transactions')
    expect(txHref({ ...EMPTY_TX_FILTER, currency: 'USDT_TRC20' }, 3)).toBe(
      '/wallet/transactions?currency=USDT_TRC20&page=3',
    )
    expect(txHref({ ...EMPTY_TX_FILTER, type: 'BET' }, 1)).toBe('/wallet/transactions?type=BET')
  })

  it('hasActiveTxParts — ложь только при полном сбросе', () => {
    expect(hasActiveTxParts(EMPTY_TX_FILTER)).toBe(false)
    expect(hasActiveTxParts({ ...EMPTY_TX_FILTER, to: '2026-09-01' })).toBe(true)
  })

  it('типы проводок имеют человеческие подписи, неизвестный — как есть', () => {
    expect(txTypeLabel('DEPOSIT')).toBe('Пополнение')
    expect(txTypeLabel('WITHDRAWAL_LOCK')).toBe('Заморозка под вывод')
    expect(txTypeLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })
})

describe('GAP-55 сумма: знак и валюта (§11)', () => {
  it('положительная — с «+», отрицательная сохраняет «−», валюта всегда при числе', () => {
    expect(formatTxAmount('1200', 'RUB')).toBe('+1 200 \u20bd')
    expect(formatTxAmount('-500', 'RUB')).toBe('-500 \u20bd')
    // формат USDT — 2 знака: установленный контракт lib/format/currency (см. format-currency.spec)
    expect(formatTxAmount('150', 'USDT_TRC20')).toBe('+150.00 USDT')
  })

  it('направление из суммы, а не из типа (ledger хранит знак)', () => {
    expect(amountDirection('100')).toBe('in')
    expect(amountDirection('-100')).toBe('out')
    expect(amountDirection('0')).toBe('zero')
  })
})

describe('GAP-55 metadata проводки', () => {
  it('читает строки и числа, игнорирует мусор (JsonValue приходит из Prisma как угодно)', () => {
    expect(metadataField({ provider: 'nowpayments' }, 'provider')).toBe('nowpayments')
    expect(metadataField({ actually_paid: 12.34 }, 'actually_paid')).toBe('12.34')
    expect(metadataField(null, 'provider')).toBeNull()
    expect(metadataField('строка', 'provider')).toBeNull()
    expect(metadataField({ nested: { a: 1 } }, 'nested')).toBeNull()
  })

  it('заморозка: сумма в metadata.locked_amount (сама проводка — 0)', () => {
    expect(lockedAmountOf({ locked_amount: '500' })).toBe('500')
    expect(lockedAmountOf({})).toBeNull()
  })

  it('сеть показывается только для крипты', () => {
    expect(networkOf('RUB')).toBeNull()
    expect(networkOf('USDT_TRC20')).toBe('TRC20')
    expect(networkOf('BTC')).toBe('Bitcoin')
  })
})

describe('GAP-55 фильтры ставок (§12)', () => {
  it('game в URL → game_id в API', () => {
    const filter = parseBetFilter(new URLSearchParams('game=abc&provider=pg-soft&currency=RUB'))
    expect(filter.gameId).toBe('abc')
    expect(betApiParams(filter)).toEqual({ game_id: 'abc', provider: 'pg-soft', currency: 'RUB' })
  })

  it('ссылка и активность', () => {
    expect(betHref({ gameId: '', provider: 'demo', currency: '', from: '', to: '' })).toBe(
      '/history?provider=demo',
    )
    expect(betHref({ gameId: '', provider: '', currency: '', from: '', to: '' })).toBe('/history')
    expect(hasActiveBetParts({ gameId: '', provider: '', currency: '', from: '', to: '' })).toBe(false)
  })
})

describe('GAP-55 агрегаты: не смешивать валюты (§12)', () => {
  const stats = [
    { currency: 'RUB', rounds: 124, turnover: '12000', wins: '11500' },
    { currency: 'USDT_TRC20', rounds: 6, turnover: '50', wins: '42' },
  ]

  it('количество ставок суммируется, деньги — нет', () => {
    expect(totalRounds(stats)).toBe(130)
  })

  it('оборот/выигрыши доступны только когда выбрана одна валюта', () => {
    expect(statsForCurrency(stats, '')).toBeNull()
    expect(statsForCurrency(stats, 'RUB')?.turnover).toBe('12000')
    expect(statsForCurrency(stats, 'KZT')).toBeNull()
  })
})
