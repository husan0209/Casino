import { afterAll, describe, expect, it } from 'vitest'


import { ExchangeRatesService } from '@modules/geo/application/exchange-rates.service'
import { GetGeoConfigUseCase } from '@modules/geo/application/use-cases/get-geo-config.use-case'
import { GeoFacade } from '@modules/geo/facade/geo.facade'
import { PrismaExchangeRatesReader } from '@modules/geo/infrastructure/exchange-rates.prisma.reader'
import { GetKycStatusUseCase } from '@modules/kyc/application/use-cases/get-kyc-status.use-case'

import { prisma } from '@casino/database'

/**
 * GAP-34 критерий 3 (real Postgres): запись в exchange_rates меняет
 * limit_remaining в ответе KYC use-case. Без LEDGER_INTEGRATION=1 — скип
 * (нет локальной БД); в CI выполняется.
 */
const d = process.env.LEDGER_INTEGRATION === '1' ? describe : describe.skip

const createdIds: string[] = []

async function makeUseCase(): Promise<GetKycStatusUseCase> {
  const reader = new PrismaExchangeRatesReader({ get: () => undefined } as never)
  const facade = new GeoFacade(new GetGeoConfigUseCase({} as never), new ExchangeRatesService(reader))
  return new GetKycStatusUseCase(
    {
      getStatus: async () => ({ kyc_status: 'unverified' }),
      getTotalDepositedRub: async () => '0',
    } as never,
    facade,
    { get: () => '5000' } as never,
  )
}

d('exchange_rates в реальном Postgres (GAP-34)', () => {
  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.exchangeRate.delete({ where: { id } }).catch(() => undefined)
    }
  })

  it('запись rate=4000 меняет limit_remaining: 5000 RUB → 1.25 USDT', async () => {
    // контроль: без записи — константа 92.5 → 54.05
    const before = await (await makeUseCase()).execute('user-x', 'USDT_TRC20')
    expect(before.limit_remaining).toBe('54.05')

    const row = await prisma.exchangeRate.create({
      data: { currencyFrom: 'USDT_TRC20', currencyTo: 'RUB', rate: '4000', source: 'spec-gap34' },
    })
    createdIds.push(row.id)

    const res = await (await makeUseCase()).execute('user-x', 'USDT_TRC20')
    expect(res.limit_remaining).toBe('1.25')
    expect(res.limit_currency).toBe('USDT_TRC20')
  })
})
