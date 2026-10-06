/**
 * Поверхность ручного разбора атрибуций (ТЗ ч.8 §13.3) — то, чем флаг F4
 * вообще можно воспользоваться.
 *
 * Квалифицированная строка с `reject_reason` (`near_threshold_deposit`)
 * ничего не значит, если администратор не может её найти, и ничего не значит
 * для партнёра, если он её не видит. Поэтому здесь проверяются обе стороны:
 *  - фильтр `reject_reason` доходит до репозитория (а не теряется в
 *    presentation), неизвестный код отсекается валидацией на входе, а не
 *    превращается в пустую страницу;
 *  - админ причину видит, партнёр — только настоящую причину отказа (это в
 *    `affiliate-cabinet-contract.spec.ts`).
 */
import { describe, expect, it, vi } from 'vitest'

import { AffiliateAdminController } from '../src/modules/affiliate/presentation/controllers/affiliate-admin.controller'
import { AttributionListQuerySchema } from '../src/modules/affiliate/presentation/dto/affiliate.dto'

interface AttributionRow {
  id: string
  affiliateId: string
  playerId: string
  status: string
  totalDeposit: string
  rejectReason: string | null
  isSelfReferral: boolean
  createdAt: Date
}

function makeRow(overrides: Partial<AttributionRow> = {}): AttributionRow {
  return {
    id: 'attr-1',
    affiliateId: 'aff-1',
    playerId: 'player-1',
    status: 'qualified',
    totalDeposit: '504.00000000',
    rejectReason: null,
    isSelfReferral: false,
    createdAt: new Date('2026-09-10T08:00:00.000Z'),
    ...overrides,
  }
}

function makeController(rows: AttributionRow[] = [makeRow()]) {
  const list = vi.fn(async () => ({ items: rows, total: rows.length }))
  const controller = new AffiliateAdminController(
    {} as never,
    {} as never,
    { list } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { controller, list }
}

describe('GET /admin/affiliate/attributions — фильтр по причине', () => {
  it('передаёт rejectReason в репозиторий, page/per_page парсит схема', async () => {
    const { controller, list } = makeController()
    const query = AttributionListQuerySchema.parse({
      page: '2',
      per_page: '50',
      reject_reason: 'near_threshold_deposit',
    })

    const res = await controller.listAttributions(query)

    expect(list).toHaveBeenCalledWith({
      status: undefined,
      rejectReason: 'near_threshold_deposit',
      page: 2,
      perPage: 50,
    })
    expect(res.meta).toEqual({ page: 2, perPage: 50, total: 1 })
  })

  it('без причины фильтр не добавляется — список остаётся полным', async () => {
    const { controller, list } = makeController()
    const query = AttributionListQuerySchema.parse({ page: 1, per_page: 20 })

    await controller.listAttributions(query)

    expect(list).toHaveBeenCalledWith({
      status: undefined,
      rejectReason: undefined,
      page: 1,
      perPage: 20,
    })
  })

  it('статус и причина фильтруют вместе: квалифицированные с флагом F4', async () => {
    const { controller, list } = makeController([
      makeRow({ rejectReason: 'near_threshold_deposit' }),
    ])
    const query = AttributionListQuerySchema.parse({
      status: 'qualified',
      reject_reason: 'near_threshold_deposit',
    })

    const res = await controller.listAttributions(query)

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'qualified', rejectReason: 'near_threshold_deposit' }),
    )
    // админ видит причину на квалифицированной строке — это и есть разбор
    expect(res.data[0]).toMatchObject({
      status: 'qualified',
      reject_reason: 'near_threshold_deposit',
    })
  })

  it('неизвестный код причины — ошибка схемы, а не пустая страница', () => {
    // «needs_review» из ТЗ §13.2 в справочник не входит: опечатка в фильтре
    // выглядела бы как «флагов нет», и разбор бы молча не состоялся
    const parsed = AttributionListQuerySchema.safeParse({
      page: 1,
      per_page: 20,
      reject_reason: 'needs_review',
    })

    expect(parsed.success).toBe(false)
  })
})
