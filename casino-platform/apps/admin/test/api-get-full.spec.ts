/**
 * Аудит контрактов 2026-09-26: apiGetFull против листингов /admin/*.
 *
 * Контроллеры админки отдают списки в трёх вариантах конверта:
 *   {items, meta}      — admin/users, /withdrawals, /payment-requests,
 *                        /transactions, /audit-logs, /games
 *   {items, total}     — admin/kyc (total без page/perPage)
 *   {data: rows, meta} — admin/support/tickets, admin/referrals
 * Страницы же читают результат как массив + meta.total. Без разворота
 * data.data.map() падал («… is not a function»), а pager показывал 0.
 * Спека фиксирует разворот и прозрачность для незнакомых payload.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedApi = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}

vi.mock('axios', () => ({ default: { create: () => mockedApi } }))

const { apiGetFull } = await import('../src/lib/api')

beforeEach(() => {
  mockedApi.get.mockReset()
})

describe('admin apiGetFull: разворот конвертов списков (аудит 2026-09-26)', () => {
  it('{items, meta} → rows + meta (admin/users, withdrawals, payments, tx, audit, games)', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        success: true,
        data: { items: [{ id: 'a1' }, { id: 'a2' }], meta: { page: 2, perPage: 20, total: 41 } },
      },
    })

    const res = await apiGetFull<Array<{ id: string }>>('/admin/users', { page: 2 })

    expect(res.data).toEqual([{ id: 'a1' }, { id: 'a2' }])
    expect(res.meta?.total).toBe(41)
    expect(res.meta?.page).toBe(2)
  })

  it('{items, total} → rows + meta={total} (admin/kyc)', async () => {
    mockedApi.get.mockResolvedValue({
      data: { success: true, data: { items: [{ id: 'k1' }], total: 7 } },
    })

    const res = await apiGetFull<Array<{ id: string }>>('/admin/kyc', { status: 'pending' })

    expect(res.data).toEqual([{ id: 'k1' }])
    expect(res.meta).toEqual({ total: 7 })
  })

  it('{data: rows, meta} → rows + meta (admin/support/tickets, admin/referrals)', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        success: true,
        data: { data: [{ id: 't1' }], meta: { total: 3 } },
      },
    })

    const res = await apiGetFull<Array<{ id: string }>>('/admin/support/tickets')

    expect(res.data).toEqual([{ id: 't1' }])
    expect(res.meta?.total).toBe(3)
  })

  it('деталка тикета {messages, id, …} проходит без изменений', async () => {
    const detail = { id: 't1', subject: 'Вопрос', status: 'open', messages: [{ id: 'm1' }] }
    mockedApi.get.mockResolvedValue({ data: { success: true, data: detail } })

    const res = await apiGetFull<typeof detail>('/admin/support/tickets/t1')

    expect(res.data).toBe(detail)
    expect(res.data.messages).toEqual([{ id: 'm1' }])
  })

  it('plain-массив проходит без изменений', async () => {
    const rows = [{ id: 'p1' }]
    mockedApi.get.mockResolvedValue({ data: { success: true, data: rows } })

    const res = await apiGetFull<Array<{ id: string }>>('/admin/providers')

    expect(res.data).toBe(rows)
  })
})
