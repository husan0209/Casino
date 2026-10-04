/**
 * G16: admin больше не тянет порт и Prisma-класс payments. Реализация его узкого
 * контракта `IWithdrawalRequestStore` — адаптер над `PaymentsFacade`, и эта спека
 * держит две вещи:
 *
 *  1) адаптер отдаёт порт ровно в том объёме, который он объявляет (лишние поля
 *     заявки не утекают в application), и `amount` остаётся money-строкой через
 *     `toString()` — Prisma-Decimal наружу не показываем (G20);
 *  2) сборка DI: `WITHDRAWAL_REQUEST_STORE` закрыт адаптером, `AdminModule`
 *     импортирует `PaymentsModule` — иначе фасад нерезолвим и одобрение вывода
 *     падает на старте контейнера (история таких падений — `admin-module-wiring`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

// Клиент БД подменяем пустым объектом: тут читают DI-метаданные и вызывают
// адаптер над фейковым фасадом. Образец — `test/gap62-provisioning-wiring.spec.ts`.
vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return { ...actual, prisma: {} }
})

import { AdminModule } from '../src/modules/admin/admin.module'
import {
  type IWithdrawalRequestStore,
  WITHDRAWAL_REQUEST_STORE,
} from '../src/modules/admin/domain/withdrawal.repository'
import { PaymentsFacadeWithdrawalGateway } from '../src/modules/admin/infrastructure/withdrawal-payments.gateway'
import { PaymentsModule } from '../src/modules/payments/payments.module'

const getPaymentRequest = vi.fn()
const updatePaymentStatus = vi.fn()

function makeGateway(): PaymentsFacadeWithdrawalGateway {
  return new PaymentsFacadeWithdrawalGateway({
    getPaymentRequest,
    updatePaymentStatus,
  } as never)
}

beforeEach(() => {
  getPaymentRequest.mockReset()
  updatePaymentStatus.mockReset()
})

describe('PaymentsFacadeWithdrawalGateway', () => {
  it('findById отдаёт только поля порта: лишнее из заявки не утекает в application', async () => {
    getPaymentRequest.mockResolvedValue({
      id: 'pr-1',
      userId: 'u-1',
      currency: 'RUB',
      // money-строка через toString(), как его видит порт
      amount: { toString: () => '1500.00' },
      type: 'withdrawal',
      status: 'pending',
      fee: { toString: () => '0' },
      destination: { card: '4000' },
      errorMessage: null,
    })

    const row = await makeGateway().findById('pr-1')

    expect(getPaymentRequest).toHaveBeenCalledWith('pr-1')
    // Сравнение по полям, не по объекту: amount — функция-объект, и toEqual
    // сверял бы её по ссылке, а не по содержимому.
    expect(Object.keys(row as object).sort()).toEqual([
      'amount',
      'currency',
      'id',
      'status',
      'type',
      'userId',
    ])
    expect(row!.id).toBe('pr-1')
    expect(row!.userId).toBe('u-1')
    expect(row!.type).toBe('withdrawal')
    expect(row!.status).toBe('pending')
    expect(row!.amount.toString()).toBe('1500.00')
  })

  it('null от фасада остаётся null: сценарий сам решает, что это за заявка', async () => {
    getPaymentRequest.mockResolvedValue(null)
    await expect(makeGateway().findById('missing')).resolves.toBeNull()
  })

  it('updateStatus — один вызов фасада с теми же аргументами, без своей логики', async () => {
    updatePaymentStatus.mockResolvedValue({ id: 'pr-1' })
    const extra = { completedAt: new Date('2026-10-04T00:00:00.000Z') }

    await makeGateway().updateStatus('pr-1', 'completed', extra)

    expect(updatePaymentStatus).toHaveBeenCalledWith('pr-1', 'completed', extra)
  })

  it('отрицательное решение: errorMessage долетает до фасада', async () => {
    updatePaymentStatus.mockResolvedValue({ id: 'pr-1' })

    await makeGateway().updateStatus('pr-1', 'failed', { errorMessage: 'отказ оператора' })

    expect(updatePaymentStatus.mock.calls[0]![2]).toEqual({
      errorMessage: 'отказ оператора',
    })
  })
})

describe('Сборка admin → payments (G16)', () => {
  const providers = Reflect.getMetadata('providers', AdminModule) as unknown[]
  const imports = Reflect.getMetadata('imports', AdminModule) as unknown[]

  it('порт заявок вывода закрыт адаптером над фасадом, а не репозиторием payments', () => {
    const entry = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        (provider as { provide?: unknown }).provide === WITHDRAWAL_REQUEST_STORE,
    ) as { useClass?: unknown } | undefined
    expect(entry?.useClass).toBe(PaymentsFacadeWithdrawalGateway)
  })

  it('AdminModule импортирует PaymentsModule — иначе PaymentsFacade нерезолвим', () => {
    expect(imports).toContain(PaymentsModule)
  })

  it('адаптер структурно подходит под контракт порта (найдётся TS-ом, проверка на месте)', () => {
    const gateway: IWithdrawalRequestStore = makeGateway()
    expect(typeof gateway.findById).toBe('function')
    expect(typeof gateway.updateStatus).toBe('function')
  })
})
