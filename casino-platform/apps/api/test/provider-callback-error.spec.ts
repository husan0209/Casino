import { beforeEach, describe, expect, it, vi } from 'vitest'

// Моки ДО импорта SUT (hoisted). GAP-57: при неизвестной ошибке (например,
// Prisma P2034) провайдер получает нейтральный INTERNAL_ERROR, а не текст
// внутренней ошибки с путями машины.
vi.mock('@casino/database', () => ({
  prisma: {
    gameProvider: {
      findUnique: vi.fn().mockResolvedValue({ id: 'provider-1', slug: 'gitslotpark' }),
    },
  },
}))

import { ProviderCallbackController } from '../src/modules/casino/presentation/controllers/provider-callback.controller'

import type { GameCallbackService } from '../src/modules/casino/application/services/game-callback.service'
import type { ProviderAdapterFactory } from '../src/modules/casino/infrastructure/providers/provider-adapter.factory'
import type { Response } from 'express'

function makeAdapter() {
  return {
    verifyCallback: vi.fn().mockReturnValue(true),
    parseCallback: vi.fn().mockReturnValue({
      action: 'bet',
      playerToken: 'uid:00000000-0000-0000-0000-000000000001',
      transactionId: 'tx-1',
      roundId: 'r-1',
      amount: '10.00',
    }),
    formatSuccessResponse: vi.fn().mockReturnValue({ status: 0, balance: '90.00' }),
    formatErrorResponse: vi.fn((code: string, message: string) => ({ status: 1, code, message })),
  }
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { json: ReturnType<typeof vi.fn> }
}

const VALID_BODY = {
  agentID: 'AGENT_LOAD_TEST',
  userID: '00000000-0000-0000-0000-000000000001',
  amount: '10.00',
  transactionID: 'tx-1',
  roundID: 'r-1',
  sign: 'A'.repeat(64),
}

describe('GAP-57: provider-callback не отдаёт текст внутренних ошибок', () => {
  let controller: ProviderCallbackController
  let adapter: ReturnType<typeof makeAdapter>
  let cbBet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = makeAdapter()
    cbBet = vi.fn()
    const adapters = {
      getAdapter: vi.fn().mockReturnValue(adapter),
    } as unknown as ProviderAdapterFactory
    const cb = { bet: cbBet } as unknown as GameCallbackService
    controller = new ProviderCallbackController(adapters, cb)
  })

  it('неизвестная ошибка (P2034) → нейтральный INTERNAL_ERROR без текста Prisma', async () => {
    cbBet.mockRejectedValue(
      Object.assign(
        new Error(
          'Invalid `tx.walletAccount.updateMany()` invocation in D:\\projects\\Casino\\apps\\api\\src',
        ),
        { code: 'P2034' },
      ),
    )
    const res = makeRes()

    await controller.handle('gitslotpark', { 'x-gsp-op': 'withdraw' }, VALID_BODY, res)

    expect(adapter.formatErrorResponse).toHaveBeenCalledWith('INTERNAL_ERROR', 'INTERNAL_ERROR')
    const body = res.json.mock.calls[0][0] as { message: string }
    expect(body.message).toBe('INTERNAL_ERROR')
    expect(body.message).not.toContain('updateMany')
    expect(body.message).not.toContain('D:\\projects')
  })

  it('известная доменная ошибка сохраняет свой код для провайдера', async () => {
    cbBet.mockRejectedValue(new Error('INSUFFICIENT_FUNDS'))
    const res = makeRes()

    await controller.handle('gitslotpark', { 'x-gsp-op': 'withdraw' }, VALID_BODY, res)

    expect(adapter.formatErrorResponse).toHaveBeenCalledWith(
      'INSUFFICIENT_FUNDS',
      'INSUFFICIENT_FUNDS',
    )
  })

  it('успешная ставка — formatSuccessResponse без изменений', async () => {
    cbBet.mockResolvedValue({ balance: '90.00' })
    const res = makeRes()

    await controller.handle('gitslotpark', { 'x-gsp-op': 'withdraw' }, VALID_BODY, res)

    expect(adapter.formatSuccessResponse).toHaveBeenCalledWith('90.00', 'tx-1')
    expect(res.json).toHaveBeenCalledWith({ status: 0, balance: '90.00' })
  })
})
