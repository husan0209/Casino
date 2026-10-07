import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateWithdrawalUseCase } from '../src/modules/payments/application/use-cases/create-withdrawal.use-case'
import {
  AmountTooLargeError,
  AmountTooSmallError,
  InvalidAmountError,
  InvalidCurrencyError,
  InvalidDestinationError,
} from '../src/modules/payments/domain/errors'
import {
  assertWithdrawableCurrency,
  assertWithdrawalDestination,
  withdrawalLimitsFor,
} from '../src/modules/payments/domain/payment-currency.policy'
import { CreateCryptoWithdrawalSchema } from '../src/modules/payments/presentation/dto/create-withdrawal.dto'
import { UpdateCurrencySchema } from '../src/modules/users/presentation/dto/update-currency.dto'

/**
 * Лимиты, валюты и реквизиты вывода.
 *
 * Три дефекта, которые здесь зафиксированы как невозвратные:
 *  1) `CreateWithdrawalUseCase` брал границы по принципу «RUB → 500/200000, всё
 *     остальное → 0.001/999999», тогда как `CURRENCY_LIMITS` задаёт
 *     `USDT_TRC20: 20/20000` и `BTC: 0.0002/1`. Для крипты верхняя граница была
 *     выше разрешённой в 50 раз, нижняя — ниже, то есть лимит на вывод (он же
 *     рисковый контроль) не действовал;
 *  2) DTO вывода держал собственный список валют с `TON`/`TRX`/`LTC` — сети,
 *     исключённые из релиза (TZ-02): заявка создавалась и уходила в ручной
 *     процессинг, где её никто не исполняет;
 *  3) мусорная сумма доходила до `new Decimal()` и давала 500 вместо стабильного
 *     кода ошибки.
 *
 * Prisma не поднимается (нет БД в этой среде) — фасады мокнуты, как в
 * withdrawal-link.spec.ts.
 */
const TRON_ADDRESS = 'TVM9udX9qEJ4s3sHZCQ3sHZgZ3CQ9dY2wq'
const BTC_LEGACY_ADDRESS = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
const BTC_BECH32_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

interface Harness {
  useCase: CreateWithdrawalUseCase
  lock: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  /** Шпион гейта верификации: `assertCanWithdraw(userId, amountRub)`. */
  kyc: { assertCanWithdraw: ReturnType<typeof vi.fn> }
}

function harness(): Harness {
  const lock = vi.fn().mockResolvedValue({ duplicate: false })
  const create = vi
    .fn()
    .mockImplementation((data: { id: string }) => Promise.resolve({ id: data.id }))
  const kyc = { assertCanWithdraw: vi.fn().mockResolvedValue(undefined) }
  // Курс фиктивный и круглый (92,5 за USDT, 1 000 000 за BTC), чтобы RUB-база
  // порога была видна в аргументе KYC и в amount_rub заявки.
  const geo = {
    convertToRubAtLiveRate: (amount: string, currency: string) => {
      if (currency === 'RUB') {
        return amount
      }
      return String(Number(amount) * (currency === 'BTC' ? 1000000 : 92.5))
    },
  }
  return {
    useCase: new CreateWithdrawalUseCase(
      { create } as never,
      { lock } as never,
      kyc as never,
      geo as never,
    ),
    lock,
    create,
    kyc,
  }
}

function cryptoInput(over: Partial<Record<'amount' | 'currency' | 'destination', string>> = {}) {
  return {
    amount: '25',
    currency: 'USDT_TRC20',
    destination: TRON_ADDRESS,
    ...over,
  }
}

describe('withdrawalLimitsFor: границы берутся из гео-конфига', () => {
  it('крипта — лимиты конфигурации, а не «0.001/999999»', () => {
    expect(withdrawalLimitsFor('USDT_TRC20')).toEqual({ min: '20', max: '20000' })
    expect(withdrawalLimitsFor('BTC')).toEqual({ min: '0.0002', max: '1' })
  })

  it('фиат совпадает с конфигурацией (RUB задан явно)', () => {
    expect(withdrawalLimitsFor('RUB')).toEqual({ min: '500', max: '200000' })
  })

  it('валюта без лимитов отклоняется, а не получает границы «на всякий случай»', () => {
    expect(() => withdrawalLimitsFor('TON')).toThrow(InvalidCurrencyError)
    expect(() => withdrawalLimitsFor('USD')).toThrow(InvalidCurrencyError)
  })
})

/**
 * Display-валюты (`UAH`/`BYN`/`KZT`/`UZS`) есть в `CURRENCY_LIMITS` — с
 * `withdrawMin`/`withdrawMax`, — но payout по ним не исполняется: это границы
 * отображаемого баланса, а не контракт выплаты. Пока гейта не было, такая
 * заявка проходила все проверки лимитов, морозила баланс на `lock` и вставала
 * в очередь, которую оператор не может исполнить.
 */
describe('assertWithdrawableCurrency: выводимая валюта ≠ валюта, у которой есть лимит', () => {
  const DISPLAY_ONLY = ['UAH', 'BYN', 'KZT', 'UZS']

  it('исполнимые валюты проходят: RUB (фиат) + релизная крипта', () => {
    for (const currency of ['RUB', 'USDT_TRC20', 'BTC']) {
      expect(() => assertWithdrawableCurrency(currency), `currency=${currency}`).not.toThrow()
    }
  })

  it('display-валюты отклоняются стабильным INVALID_CURRENCY', () => {
    for (const currency of DISPLAY_ONLY) {
      expect(() => assertWithdrawableCurrency(currency), `currency=${currency}`).toThrow(
        InvalidCurrencyError,
      )
      expect(() => withdrawalLimitsFor(currency), `currency=${currency}`).toThrow(
        /cannot be withdrawn/,
      )
    }
  })

  it('неизвестный код платформы отличается от «есть, но не выводится»', () => {
    expect(() => withdrawalLimitsFor('USD')).toThrow(/has no withdrawal limits/)
    expect(() => withdrawalLimitsFor('UAH')).toThrow(/cannot be withdrawn/)
  })

  it('вход в сообщение обрезается — длинный код не уезжает в ответ целиком', () => {
    const long = `UAH${'x'.repeat(40)}`
    let message = ''
    try {
      assertWithdrawableCurrency(long)
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('UAH')
    expect(message).not.toContain('x'.repeat(40))
  })
})

describe('assertWithdrawalDestination: адрес должен принадлежать сети', () => {
  it('адрес Tron в заявке BTC отклоняется', () => {
    expect(() => assertWithdrawalDestination('BTC', TRON_ADDRESS)).toThrow(InvalidDestinationError)
  })

  it('адрес 0x (EVM) в USDT_TRC20 отклоняется', () => {
    expect(() =>
      assertWithdrawalDestination('USDT_TRC20', '0x3f03b1a6dcbcd5a16e7c0c2b9e5d3a1e5c0b9d1f'),
    ).toThrow(InvalidDestinationError)
  })

  it('valid-адресы релизных сетей проходят (legacy, bech32, tron)', () => {
    expect(() => assertWithdrawalDestination('BTC', BTC_LEGACY_ADDRESS)).not.toThrow()
    expect(() => assertWithdrawalDestination('BTC', BTC_BECH32_ADDRESS)).not.toThrow()
    expect(() => assertWithdrawalDestination('USDT_TRC20', TRON_ADDRESS)).not.toThrow()
  })

  it('реквизиты фиата этим слоем не проверяются (процессинг, не сеть)', () => {
    expect(() => assertWithdrawalDestination('RUB', '2200700012345678')).not.toThrow()
  })

  it('в сообщении ошибки не оказывается сам адрес — только валюта', () => {
    let message = ''
    try {
      assertWithdrawalDestination('BTC', TRON_ADDRESS)
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).not.toContain(TRON_ADDRESS)
    expect(message).toContain('network')
  })
})

describe('CreateCryptoWithdrawalSchema: набор валют вывода = релизный', () => {
  it('TON/TRX/LTC больше не принимаются на вход', () => {
    for (const currency of ['TON', 'TRX', 'LTC']) {
      expect(
        CreateCryptoWithdrawalSchema.safeParse(cryptoInput({ currency })).success,
        `currency=${currency}`,
      ).toBe(false)
    }
  })

  it('релизные валюты принимаются', () => {
    expect(
      CreateCryptoWithdrawalSchema.safeParse({
        amount: '0.001',
        currency: 'BTC',
        destination: BTC_LEGACY_ADDRESS,
      }).success,
    ).toBe(true)
    expect(CreateCryptoWithdrawalSchema.safeParse(cryptoInput()).success).toBe(true)
  })

  it('сумма в экспоненциальной форме не проходит (её не разберёт Decimal-контракт)', () => {
    expect(CreateCryptoWithdrawalSchema.safeParse(cryptoInput({ amount: '1e-8' })).success).toBe(
      false,
    )
  })
})

describe('UpdateCurrencySchema: предпочтение валюты — whitelist платформы', () => {
  it('внутренние коды из набора принимаются', () => {
    for (const currency of ['RUB', 'UAH', 'KZT', 'USDT_TRC20', 'BTC']) {
      expect(UpdateCurrencySchema.safeParse({ currency }).success, `currency=${currency}`).toBe(
        true,
      )
    }
  })

  it('пройденная ранее мусор-строка отклоняется', () => {
    for (const currency of ['xx', 'USD', 'rub', 'RUB ', '🐸🐸', 'VERYLONGCURRENCYCODE']) {
      expect(UpdateCurrencySchema.safeParse({ currency }).success, `currency=${currency}`).toBe(
        false,
      )
    }
  })
})

describe('CreateWithdrawalUseCase: money-контракт и границы по валюте', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  it('0.001 USDT отклоняется с минимумом из конфигурации (20), а не 0.001', async () => {
    await expect(h.useCase.execute('u1', cryptoInput({ amount: '0.001' }))).rejects.toThrow(
      AmountTooSmallError,
    )
    expect(h.lock).not.toHaveBeenCalled()
  })

  it('заявка выше конфигурационного максимума USDT отклоняется', async () => {
    await expect(h.useCase.execute('u1', cryptoInput({ amount: '20001' }))).rejects.toThrow(
      AmountTooLargeError,
    )
    expect(h.lock).not.toHaveBeenCalled()
  })

  it('прежний захардкод пропускал 50000 USDT — теперь граница 20000', async () => {
    await expect(h.useCase.execute('u1', cryptoInput({ amount: '50000' }))).rejects.toThrow(
      AmountTooLargeError,
    )
  })

  it('BTC ниже конфигурационного минимума отклоняется', async () => {
    await expect(
      h.useCase.execute(
        'u1',
        cryptoInput({ amount: '0.0001', currency: 'BTC', destination: BTC_BECH32_ADDRESS }),
      ),
    ).rejects.toThrow(AmountTooSmallError)
  })

  it('корректная крипто-заявка проходит и сумма уходит строкой', async () => {
    await h.useCase.execute('u1', cryptoInput({ amount: '25.5' }))
    const lockArg = h.lock.mock.calls[0]?.[0] as { amount: unknown; currency: unknown }
    const createArg = h.create.mock.calls[0]?.[0] as { amount: unknown; destination: unknown }
    expect(typeof lockArg.amount).toBe('string')
    expect(lockArg.amount).toBe('25.5')
    expect(createArg.amount).toBe('25.5')
    expect(createArg.destination).toBe(TRON_ADDRESS)
  })

  // Порог «вывод без верификации» объявлен в рублях и он один на все валюты,
  // поэтому use-case обязан передавать в KYC RUB-эквивалент, а не монеты: с
  // «25.5» гейт считал бы 25,5 ₽ и пропускал бы 2 359 ₽ (решение владельца
  // 2026-10-07). Курс в стенке: USDT ×92,5, BTC ×1 000 000.
  it('в KYC уходит RUB-эквивалент заявки, а не сумма в монетах', async () => {
    await h.useCase.execute('u1', cryptoInput({ amount: '25.5' }))
    expect(h.kyc.assertCanWithdraw).toHaveBeenCalledWith('u1', '2358.75')
  })

  it('RUB-заявка передаётся в KYC без пересчёта', async () => {
    await h.useCase.execute('u1', {
      amount: '5000',
      currency: 'RUB',
      method: 'card',
      destination: '2200700012345678',
    })
    expect(h.kyc.assertCanWithdraw).toHaveBeenCalledWith('u1', '5000')
  })

  it('BTC считается по своему курсу, а не как RUB', async () => {
    await h.useCase.execute(
      'u1',
      cryptoInput({ amount: '0.005', currency: 'BTC', destination: BTC_BECH32_ADDRESS }),
    )
    expect(h.kyc.assertCanWithdraw).toHaveBeenCalledWith('u1', '5000')
  })

  it('RUB-эквивалент записывается в заявку — база порога на следующие заявки', async () => {
    await h.useCase.execute('u1', cryptoInput({ amount: '25.5' }))
    const createArg = h.create.mock.calls[0]?.[0] as { amountRub: unknown }
    expect(createArg.amountRub).toBe('2358.75')
  })

  it('отказ KYC не замораживает баланс и не создаёт заявку', async () => {
    h.kyc.assertCanWithdraw.mockRejectedValue(new Error('KYC_REQUIRED'))
    await expect(h.useCase.execute('u1', cryptoInput({ amount: '25.5' }))).rejects.toThrow(
      'KYC_REQUIRED',
    )
    expect(h.lock).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('границы валюты проверяются до требования KYC — опечатку показываем раньше', async () => {
    await expect(h.useCase.execute('u1', cryptoInput({ amount: '5' }))).rejects.toThrow(
      AmountTooSmallError,
    )
    expect(h.kyc.assertCanWithdraw).not.toHaveBeenCalled()
  })

  it('мусорная сумма даёт стабильный INVALID_AMOUNT, а не 500 от decimal.js', async () => {
    await expect(h.useCase.execute('u1', cryptoInput({ amount: 'abc' }))).rejects.toThrow(
      InvalidAmountError,
    )
    const error = (await h.useCase
      .execute('u1', cryptoInput({ amount: 'abc' }))
      .catch((e: unknown) => e)) as InvalidAmountError
    expect(error.code).toBe('INVALID_AMOUNT')
    expect(error.httpStatus).toBe(422)
  })

  it('нерелизная валюта отклоняется до блокировки средств', async () => {
    await expect(h.useCase.execute('u1', cryptoInput({ currency: 'TON' }))).rejects.toThrow(
      InvalidCurrencyError,
    )
    expect(h.lock).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('адрес чужой сети отклоняется до блокировки средств', async () => {
    await expect(
      h.useCase.execute('u1', cryptoInput({ currency: 'BTC', destination: TRON_ADDRESS })),
    ).rejects.toThrow(InvalidDestinationError)
    expect(h.lock).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('заявка display-валюты (UAH) отклоняется до блокировки баланса', async () => {
    await expect(
      h.useCase.execute('u1', {
        amount: '5000',
        currency: 'UAH',
        method: 'card',
        destination: '380999999999',
      }),
    ).rejects.toThrow(InvalidCurrencyError)
    expect(h.lock).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('фиатный путь (RUB, карта) работает как раньше', async () => {
    await h.useCase.execute('u1', {
      amount: '1000',
      currency: 'RUB',
      method: 'card',
      destination: '2200700012345678',
    })
    expect(h.create).toHaveBeenCalled()
  })
})
