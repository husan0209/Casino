/**
 * GAP-55 (з): юнит-тесты валидаторов вывода (ТЗ ч.5 §10.3).
 * Ключевой кейс — сети не путаются: TRC20-адрес не проходит валидацию BTC
 * и наоборот (§10.3 требует этого явно).
 */
import { describe, expect, it } from 'vitest'

import {
  checkWithdrawAmount,
  limitsFor,
  fiatMethodLabel,
  isCryptoCurrency,
  maskDestination,
  networkLabel,
  normalizeDestination,
  resolveWithdrawPrecheck,
  validateDestination,
  withdrawPresets,
} from '../src/lib/ui/withdraw'

const TRC20 = 'TMr2RrexiUr3NB4u4SHXKLnvQCVj3CH3x9' // T + 33 = 34 символа
const BTC_LEGACY = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
const BTC_BECH32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'

describe('GAP-55 лимиты и пресеты', () => {
  it('минимумы совпадают с CreateWithdrawalUseCase', () => {
    expect(limitsFor('RUB')).toEqual({ min: '500', max: '200000' })
    expect(limitsFor('USDT_TRC20').min).toBe('0.001')
    expect(limitsFor('BTC').min).toBe('0.001')
  })

  it('пресеты только у фиата и USDT; у BTC пресетов нет (§2.5)', () => {
    expect(withdrawPresets('RUB')).toEqual(['1000', '2000', '5000', '10000'])
    expect(withdrawPresets('USDT_TRC20')).toEqual(['20', '50', '100', '200'])
    expect(withdrawPresets('BTC')).toEqual([])
  })
})

describe('GAP-55 валидация реквизитов (§10.3)', () => {
  it('карта: 16–19 цифр, пробелы и дефисы нормализуются', () => {
    expect(validateDestination({ currency: 'RUB', method: 'card', value: '2200 7000 1234 5678' })).toBeNull()
    expect(validateDestination({ currency: 'RUB', method: 'card', value: '2200-7000-1234-5678' })).toBeNull()
    expect(normalizeDestination({ currency: 'RUB', method: 'card', value: '2200 7000 1234 5678' })).toBe(
      '2200700012345678',
    )
  })

  it('карта: буквы и короткое число отбиваются', () => {
    expect(validateDestination({ currency: 'RUB', method: 'card', value: '2200 7000 abcd 5678' })).toContain('только цифры')
    expect(validateDestination({ currency: 'RUB', method: 'card', value: '1234' })).toContain('16–19')
  })

  it('СБП: телефон из 11 цифр', () => {
    expect(validateDestination({ currency: 'RUB', method: 'sbp', value: '79991234567' })).toBeNull()
    expect(validateDestination({ currency: 'RUB', method: 'sbp', value: '+7 999 123-45-67' })).toContain('11 цифр')
  })

  it('адреса: валидные формы проходят', () => {
    // длина фикстуры — часть контракта (regex требует T + 33)
    expect(TRC20).toHaveLength(34)
    expect(validateDestination({ currency: 'USDT_TRC20', value: TRC20 })).toBeNull()
    expect(validateDestination({ currency: 'BTC', value: BTC_LEGACY })).toBeNull()
    expect(validateDestination({ currency: 'BTC', value: BTC_BECH32 })).toBeNull()
  })

  it('обрезанный адрес отбивается (32 вместо 34)', () => {
    expect(validateDestination({ currency: 'USDT_TRC20', value: TRC20.slice(0, 32) })).not.toBeNull()
  })

  it('TRC20-адрес НЕ проходит валидацию BTC и наоборот (§10.3)', () => {
    expect(validateDestination({ currency: 'BTC', value: TRC20 })).not.toBeNull()
    expect(validateDestination({ currency: 'USDT_TRC20', value: BTC_LEGACY })).not.toBeNull()
    expect(validateDestination({ currency: 'USDT_TRC20', value: BTC_BECH32 })).not.toBeNull()
  })

  it('пустое поле и неизвестная валюта дадут текст, а не undefined', () => {
    expect(validateDestination({ currency: 'RUB', method: 'card', value: '   ' })).toBe('Укажите реквизиты')
    expect(validateDestination({ currency: 'ETH', value: 'x' })).toBe('Неизвестная валюта')
  })
})

describe('GAP-55 проверка суммы (деньги — Decimal, не number)', () => {
  it('ниже минимума / выше максимума / больше остатка — отказ с причиной', () => {
    expect(checkWithdrawAmount({ amount: '100', currency: 'RUB', available: '5000' }).reason).toBe('min')
    expect(checkWithdrawAmount({ amount: '300000', currency: 'RUB', available: '500000' }).reason).toBe('max')
    expect(checkWithdrawAmount({ amount: '6000', currency: 'RUB', available: '5000' }).reason).toBe('insufficient')
  })

  it('мусор в поле — format, а не NaN-арифметика', () => {
    expect(checkWithdrawAmount({ amount: 'abc', currency: 'RUB', available: '5000' }).reason).toBe('format')
    expect(checkWithdrawAmount({ amount: '', currency: 'RUB', available: '5000' }).reason).toBe('format')
  })

  it('разделители тысяч (пробел) принимаются, точная граница остатка — ок', () => {
    expect(checkWithdrawAmount({ amount: '1 000', currency: 'RUB', available: '1000' }).ok).toBe(true)
    expect(checkWithdrawAmount({ amount: '0.001', currency: 'BTC', available: '0.002' }).ok).toBe(true)
  })
})

describe('GAP-55 порядок проверок до формы (§10.3)', () => {
  const wallets = [
    { currency: 'RUB', available: '0' },
    { currency: 'USDT_TRC20', available: '150' },
  ]

  it('KYC не approved — стоп ПЕРЕД всеми остальными проверками', () => {
    const blocked = resolveWithdrawPrecheck({ kycApproved: false, activeCurrency: 'RUB', wallets: [{ currency: 'RUB', available: '9999' }] })
    expect(blocked).toEqual({ kind: 'kyc_required' })
  })

  it('активный кошелёк с деньгами — форма в активной валюте', () => {
    expect(resolveWithdrawPrecheck({ kycApproved: true, activeCurrency: 'RUB', wallets: [{ currency: 'RUB', available: '1200' }] })).toEqual({
      kind: 'form',
      currency: 'RUB',
      available: '1200',
    })
  })

  it('активный пуст, в другом есть — предлагаем вывести ту валюту', () => {
    const result = resolveWithdrawPrecheck({ kycApproved: true, activeCurrency: 'RUB', wallets })
    expect(result).toMatchObject({ kind: 'suggest_currency', from: 'RUB', to: 'USDT_TRC20', amount: '150' })
  })

  it('денег нет нигде — «Нечего выводить»', () => {
    expect(
      resolveWithdrawPrecheck({
        kycApproved: true,
        activeCurrency: 'RUB',
        wallets: [{ currency: 'RUB', available: '0' }],
      }),
    ).toEqual({ kind: 'nothing_to_withdraw' })
  })

  it('кошелька активной валюты вообще нет — не нулевая форма, а предложение/отказ', () => {
    expect(resolveWithdrawPrecheck({ kycApproved: true, activeCurrency: 'KZT', wallets })).toMatchObject({
      kind: 'suggest_currency',
      to: 'USDT_TRC20',
    })
  })
})

describe('GAP-55 подписи, сеть и маскировка реквизитов', () => {
  it('сеть крипты видна и фиксирована валютой (§2.7)', () => {
    expect(isCryptoCurrency('USDT_TRC20')).toBe(true)
    expect(isCryptoCurrency('RUB')).toBe(false)
    expect(networkLabel('USDT_TRC20')).toBe('TRC20')
    expect(networkLabel('BTC')).toBe('Bitcoin')
  })

  it('способы вывода — подписи для card/sbp (значения = enum бэка)', () => {
    expect(fiatMethodLabel('card')).toBe('Карта')
    expect(fiatMethodLabel('sbp')).toBe('СБП')
  })

  it('на подтверждении карта показана последними цифрами, а не целиком (SECURITY_BASELINE)', () => {
    const masked = maskDestination({ currency: 'RUB', method: 'card', value: '2200 7000 1234 5678' })
    expect(masked).toBe('\u2022\u2022\u2022\u2022 5678')
    expect(masked).not.toContain('2200')
  })

  it('телефон.masked: первая цифра + последние 4', () => {
    expect(maskDestination({ currency: 'RUB', method: 'sbp', value: '79991234567' })).toBe('7\u2022\u2022\u2022 4567')
  })

  it('адрес крипты — префикс и суффикс (проверить глазами можно, дампнуть нельзя)', () => {
    const masked = maskDestination({ currency: 'USDT_TRC20', value: TRC20 })
    expect(masked.startsWith('TMr2Rr')).toBe(true)
    expect(masked.endsWith('3x9')).toBe(true)
    expect(masked.length).toBeLessThan(TRC20.length)
  })
})
