/**
 * Юнит-тесты ProcessRukassaWebhookUseCase (G21).
 *
 * Их контракт уведомления (lk.rukassa.io/api/v1): form-полями id, order_id,
 * amount, in_amount, data, createdDateTime, status; подпись HMAC-SHA256 в
 * заголовке `signature`; ответ провайдеру — текст (`OK` / `ERROR AMOUNT`),
 * иначе доставка повторяется до 5 раз.
 *
 * Закрываем то, что не видно в «эскалационном» спекe: отказ подписи, недоплата,
 * промежуточный WAIT, резолв платёжки по `data` и поведение при собственном
 * сбое (не принимать доставку, чтобы провайдер повторил).
 */
import { Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ProcessRukassaWebhookUseCase,
  type ProcessRukassaWebhookInput,
} from '../src/modules/payments/application/use-cases/process-rukassa-webhook.use-case'

import type {
  IPaymentRequestRepository,
  IRukassaClient,
  PaymentRequest,
} from '../src/modules/payments/domain/payments.ports'

/** Строка платёжки в фейке: ровно те поля, которые читает вебхук. */
type Row = {
  id: string
  userId: string
  provider: string
  type: string
  externalId: string | null
  method: string | null
  status: string
  currency: string
  amount: { toString(): string }
}

type CreditArgs = {
  userId: string
  amount: string
  idempotencyKey: string
  currency: string
  type: string
  description: string
  metadata: Record<string, unknown>
}

function makeRow(over: Partial<Row> = {}): Row {
  return {
    id: 'pr-1',
    userId: 'u-1',
    provider: 'rukassa',
    type: 'deposit',
    externalId: '4242',
    method: 'card',
    status: 'pending',
    currency: 'RUB',
    amount: { toString: () => '3000' },
    ...over,
  }
}

function makeDeps(
  over: {
    rows?: Row[]
    signatureValid?: boolean
    verifyThrows?: Error
    creditThrows?: Error
    findByIdThrows?: Error
    findByExternalIdThrows?: Error
  } = {},
) {
  const rows = over.rows ?? [makeRow()]
  const saved: Array<{ externalId: string; rawBody: string }> = []
  const callbackResults: Array<{ id: string; result: string | undefined }> = []
  const statusUpdates: Array<{ id: string; status: string }> = []
  const credited: CreditArgs[] = []
  const escalated: string[] = []

  const repo = {
    saveCallback: async (data: { externalId?: string; rawBody?: string }) => {
      saved.push({ externalId: data.externalId ?? '', rawBody: data.rawBody ?? '' })
      return { id: `cb-${saved.length}` } as never
    },
    markCallbackProcessed: async (id: string, result?: string) => {
      callbackResults.push({ id, result })
      return {} as never
    },
    findById: async (id: string) => {
      if (over.findByIdThrows) {
        throw over.findByIdThrows
      }
      return rows.find((row) => row.id === id) ?? null
    },
    findByExternalId: async (externalId: string, provider: string) => {
      if (over.findByExternalIdThrows) {
        throw over.findByExternalIdThrows
      }
      return rows.find((row) => row.externalId === externalId && row.provider === provider) ?? null
    },
    updateStatus: async (id: string, status: string) => {
      statusUpdates.push({ id, status })
      const row = rows.find((candidate) => candidate.id === id)
      if (row) {
        row.status = status
      }
      return (row ?? {}) as unknown as PaymentRequest
    },
  } as unknown as IPaymentRequestRepository

  const client = {
    verifyCallback: () => {
      if (over.verifyThrows) {
        throw over.verifyThrows
      }
      return over.signatureValid ?? true
    },
  } as unknown as IRukassaClient

  const wallet = {
    credit: async (args: CreditArgs) => {
      if (over.creditThrows) {
        throw over.creditThrows
      }
      credited.push(args)
      return { ok: true }
    },
  } as never
  const users = { onDepositCompleted: async () => undefined } as never
  const kyc = {
    escalateOverDepositLimit: async (args: { userId: string }) => {
      escalated.push(args.userId)
    },
  } as never

  return {
    rows,
    saved,
    callbackResults,
    statusUpdates,
    credited,
    escalated,
    uc: new ProcessRukassaWebhookUseCase(repo, client, wallet, users, kyc),
  }
}

/** Их уведомление по умолчанию: PAID на 3000, data с нашим id заявки. */
function notification(over: Record<string, unknown> = {}): ProcessRukassaWebhookInput {
  const body: Record<string, unknown> = {
    id: '4242',
    order_id: '1750000000000001',
    amount: '3000',
    in_amount: '3000',
    createdDateTime: '2026-10-12T10:00:00Z',
    status: 'PAID',
    data: '{"payment_request_id":"pr-1"}',
    ...over,
  }
  return {
    rawHeaders: { signature: 'a'.repeat(64) },
    body,
    rawBody: 'amount=3000&id=4242',
    ip: '5.6.7.8',
  }
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})

describe('ProcessRukassaWebhookUseCase', () => {
  it('PAID: зачисление по сумме заявки, completed, ответ OK', async () => {
    const d = makeDeps()

    const reply = await d.uc.execute(notification())

    expect(reply).toBe('OK')
    expect(d.credited).toHaveLength(1)
    const entry = d.credited[0]!
    expect(entry.userId).toBe('u-1')
    expect(entry.amount).toBe('3000')
    expect(entry.currency).toBe('RUB')
    expect(entry.type).toBe('DEPOSIT')
    // проводка привязана к id платежа провайдера — это анти-дубль ключ
    expect([entry.idempotencyKey]).toEqual(['deposit_rukassa_4242'])
    expect(d.statusUpdates).toEqual([{ id: 'pr-1', status: 'completed' }])
    expect(d.callbackResults).toEqual([{ id: 'cb-1', result: 'ok' }])
    expect(d.escalated).toEqual(['u-1'])
  })

  it('raw-байты уведомления сохраняются до проверки подписи (forensics)', async () => {
    const d = makeDeps({ signatureValid: false })

    await d.uc.execute(notification())

    expect(d.saved).toEqual([{ externalId: '4242', rawBody: 'amount=3000&id=4242' }])
  })

  it('подпись не прошла: FAIL, зачисления нет, коллбэк помечен invalid_signature', async () => {
    const d = makeDeps({ signatureValid: false })

    const reply = await d.uc.execute(notification())

    expect(reply).toBe('FAIL')
    expect(d.credited).toHaveLength(0)
    expect(d.statusUpdates).toHaveLength(0)
    expect(d.callbackResults).toEqual([{ id: 'cb-1', result: 'invalid_signature' }])
  })

  it('недоплата (in_amount < amount): ERROR AMOUNT и без зачисления', async () => {
    const d = makeDeps()

    const reply = await d.uc.execute(notification({ in_amount: '1000' }))

    expect(reply).toBe('ERROR AMOUNT')
    expect(d.credited).toHaveLength(0)
    expect(d.rows[0]!.status).toBe('pending')
    expect(d.callbackResults).toEqual([{ id: 'cb-1', result: 'amount_mismatch' }])
  })

  it('переплата проходит: in_amount >= amount — это их условие успеха', async () => {
    const d = makeDeps()

    expect(await d.uc.execute(notification({ in_amount: '3500' }))).toBe('OK')
    expect(d.credited).toHaveLength(1)
  })

  it('WAIT: processing, OK, ни зачисления, ни отказа', async () => {
    const d = makeDeps()

    const reply = await d.uc.execute(notification({ status: 'WAIT' }))

    expect(reply).toBe('OK')
    expect(d.statusUpdates).toEqual([{ id: 'pr-1', status: 'processing' }])
    expect(d.credited).toHaveLength(0)
  })

  it('CANCEL: failed (в противном случае заявка осталась бы pending навсегда)', async () => {
    const d = makeDeps()

    expect(await d.uc.execute(notification({ status: 'CANCEL' }))).toBe('OK')
    expect(d.statusUpdates).toEqual([{ id: 'pr-1', status: 'failed' }])
  })

  it('платёжку находим по data, даже если external_id провайдера не сохранён', async () => {
    const d = makeDeps({ rows: [makeRow({ externalId: null })] })

    expect(await d.uc.execute(notification())).toBe('OK')
    expect(d.credited).toHaveLength(1)
  })

  it('битый data: откат на поиск по их id операции', async () => {
    const d = makeDeps()

    expect(await d.uc.execute(notification({ data: 'не-json' }))).toBe('OK')
    expect(d.credited).toHaveLength(1)
  })

  it('HTML-сущности в data (их html_entity_decode) тоже разбираются', async () => {
    const d = makeDeps()

    const reply = await d.uc.execute(
      notification({ data: '{&quot;payment_request_id&quot;:&quot;pr-1&quot;}' }),
    )

    expect(reply).toBe('OK')
    expect(d.credited).toHaveLength(1)
  })

  it('data указывает на заявку другого провайдера — не зачисляем', async () => {
    const d = makeDeps({ rows: [makeRow({ provider: 'nowpayments' })] })

    const reply = await d.uc.execute(notification())

    expect(reply).toBe('OK')
    expect(d.credited).toHaveLength(0)
    expect(d.callbackResults).toEqual([{ id: 'cb-1', result: 'payment_request_not_found' }])
  })

  it('повторная доставка: duplicate, второго зачисления нет', async () => {
    const d = makeDeps()
    const one = notification()

    expect(await d.uc.execute(one)).toBe('OK')
    expect(await d.uc.execute(one)).toBe('OK')

    expect(d.credited).toHaveLength(1)
    expect(d.callbackResults[1]).toEqual({ id: 'cb-2', result: 'duplicate' })
  })

  it('уведомление по неизвестной платёжке: OK, чтобы не плодить 5 повторов', async () => {
    const d = makeDeps({ rows: [] })

    expect(await d.uc.execute(notification())).toBe('OK')
    expect(d.callbackResults).toEqual([{ id: 'cb-1', result: 'payment_request_not_found' }])
  })

  it('data переписан на чужую заявку (external_id не совпал с подписанным id) — не зачисляем', async () => {
    // Подпись покрывает id|createdDateTime|amount, но НЕ data: перехваченное
    // уведомление нельзя позволять переставлять на другую платёжку.
    const d = makeDeps({ rows: [makeRow({ externalId: '7777' })] })

    const reply = await d.uc.execute(notification())

    expect(reply).toBe('OK')
    expect(d.credited).toHaveLength(0)
    expect(d.callbackResults).toEqual([{ id: 'cb-1', result: 'payment_request_not_found' }])
  })

  it('data указывает на заявку другого типа (вывод) — не зачисляем', async () => {
    const d = makeDeps({ rows: [makeRow({ externalId: null, type: 'withdrawal' })] })

    expect(await d.uc.execute(notification())).toBe('OK')
    expect(d.credited).toHaveLength(0)
  })

  it('расхождение суммы заявки и подписанной amount — ERROR AMOUNT, без зачисления', async () => {
    const d = makeDeps({ rows: [makeRow({ amount: { toString: () => '5000' } })] })

    const reply = await d.uc.execute(notification())

    expect(reply).toBe('ERROR AMOUNT')
    expect(d.credited).toHaveLength(0)
    expect(d.statusUpdates).toHaveLength(0)
    expect(d.callbackResults).toEqual([{ id: 'cb-1', result: 'amount_mismatch' }])
  })

  it('external_id ещё не записан и сумма не совпала с подписанной — data не принимаем', async () => {
    const d = makeDeps({
      rows: [makeRow({ externalId: null, amount: { toString: () => '5000' } })],
    })

    expect(await d.uc.execute(notification())).toBe('OK')
    expect(d.credited).toHaveLength(0)
    expect(d.callbackResults).toEqual([{ id: 'cb-1', result: 'payment_request_not_found' }])
  })

  it('собственный сбой (БД/кошелёк) — FAIL: провайдер повторит, зачисление идемпотентно', async () => {
    const dbDown = makeDeps({ findByExternalIdThrows: new Error('db down') })
    expect(await dbDown.uc.execute(notification())).toBe('FAIL')
    expect(dbDown.callbackResults[0]!.result).toContain('db down')

    const creditFails = makeDeps({ creditThrows: new Error('wallet lock') })
    expect(await creditFails.uc.execute(notification())).toBe('FAIL')
    expect(creditFails.statusUpdates).toHaveLength(0)
  })
})
