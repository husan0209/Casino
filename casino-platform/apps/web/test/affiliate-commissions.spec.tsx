import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Разбивка в карточке начисления: подпись и значение обязаны соответствовать друг
 * другу. До правки строка называлась «NGR × 30%», а показывала `ngr_amount` — база
 * умножения выдавалась за результат, и партнёр видел в расшифровке число, не равное
 * начислению в заголовке карточки.
 */

const ROW = {
  id: 'cm-1',
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  currency: 'RUB',
  bet_sum: '180000.00',
  win_sum: '101070.00',
  rollback_sum: '0.00',
  bonus_sum: '600.00',
  provider_fee_sum: '0.00',
  ggr_amount: '78930.00',
  ngr_amount: '61402.10',
  revshare_rate: '0.30',
  commission_amount: '18420.55',
  status: 'credited',
  credited_at: '2026-10-01T03:00:00.000Z',
}

const affiliateGetMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/affiliate-api', () => ({
  affiliateGet: affiliateGetMock,
  affiliatePost: vi.fn(),
  affiliatePatch: vi.fn(),
  affiliateErrText: (e: unknown): string => String(e),
  setAffiliateToken: vi.fn(),
}))

import Page from '@/app/affiliate/(cabinet)/commissions/page'
import { formatAmount, formatRate } from '@/lib/affiliate-format'

/** Мобильные карточки и десктопная таблица живут в DOM одновременно (разные брейкпоинты). */
function mobileCards(container: HTMLElement): HTMLElement {
  const block = [...container.querySelectorAll('div')].find((d) =>
    d.className.includes('md:hidden'),
  )
  if (!block) {
    throw new Error('блок мобильных карточек (className содержит md:hidden) не отрендерен')
  }
  return block
}

function renderPage(): { container: HTMLElement } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  affiliateGetMock.mockReset()
  affiliateGetMock.mockResolvedValue({ data: [ROW], meta: { page: 1, perPage: 20, total: 1 } })
})

afterEach(cleanup)

describe('Аффилиат / начисления: расшифровка в карточке', () => {
  it('строка «NGR» показывает базу, а не начисление', async () => {
    const { container } = renderPage()
    // ждать именно строку начисления: «NGR» встречается и в статичном пояснении
    await screen.findAllByText(ROW.period_start)

    const ngr = formatAmount(ROW.ngr_amount, ROW.currency)
    const commission = formatAmount(ROW.commission_amount, ROW.currency)
    const row = within(mobileCards(container)).getByText('NGR', { exact: true }).parentElement

    expect(row?.textContent).toContain(ngr)
    expect(row?.textContent).not.toContain(commission)
  })

  it('строка со ставкой показывает произведение NGR × ставка = начисление', async () => {
    const { container } = renderPage()
    await screen.findAllByText(ROW.period_start)

    const label = `× ${formatRate(ROW.revshare_rate)}`
    const row = within(mobileCards(container)).getByText(label, { exact: true }).parentElement

    expect(row?.textContent).toContain(formatAmount(ROW.commission_amount, ROW.currency))
    expect(row?.textContent).not.toContain(formatAmount(ROW.ngr_amount, ROW.currency))
  })
})
