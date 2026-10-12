/**
 * HTTP-контракт вебхуков платежей: что именно уходит провайдеру.
 *
 * Для Rukassa ответ — ГОЛЫЙ ТЕКСТ (`OK` / `ERROR AMOUNT` / `FAIL`), а не JSON-конверт:
 * доставка считается принятой только при теле `OK`, иначе провайдер повторяет до 5 раз.
 * Поэтому хендлер идёт через @Res() мимо ResponseFormatInterceptor, а статус всегда
 * 200 (AGENTS.md правило 9). Разбор тела живёт в спеке use-case.
 */
import { type ProcessNOWPaymentsWebhookUseCase } from '../src/modules/payments/application/use-cases/process-nowpayments-webhook.use-case'
import {
  type ProcessRukassaWebhookUseCase,
  type RukassaWebhookReply,
} from '../src/modules/payments/application/use-cases/process-rukassa-webhook.use-case'
import { PaymentsWebhookController } from '../src/modules/payments/presentation/controllers/payments-webhook.controller'

type Captured = {
  statusCode: number
  body: string
  contentType: string
}

function fakeResponse(captured: Captured): unknown {
  const res = {
    status(code: number) {
      captured.statusCode = code
      return res
    },
    type(value: string) {
      captured.contentType = value
      return res
    },
    send(body: string) {
      captured.body = body
      return res
    },
  }
  return res
}

function makeController(reply: RukassaWebhookReply): PaymentsWebhookController {
  const rukassa = {
    execute: async () => reply,
  } as unknown as ProcessRukassaWebhookUseCase
  const nowpayments = {
    execute: async () => ({ ok: true }),
  } as unknown as ProcessNOWPaymentsWebhookUseCase
  return new PaymentsWebhookController(rukassa, nowpayments)
}

const REQUEST = { rawBody: 'amount=3000&id=4242', ip: '5.6.7.8' }

describe('PaymentsWebhookController — ответы провайдерам', () => {
  it.each([
    ['OK', 'OK'],
    ['ERROR AMOUNT', 'ERROR AMOUNT'],
    ['FAIL', 'FAIL'],
  ] as const)('%s -> 200 с телом %s', async (reply, expectedBody) => {
    const captured: Captured = { statusCode: 0, body: '', contentType: '' }

    await makeController(reply).rukassaCb(
      { signature: 'a'.repeat(64) },
      {},
      REQUEST,
      fakeResponse(captured) as never,
    )

    // Статус всегда 200: вебхуку не отказываем им (AGENTS.md правило 9).
    expect(captured.statusCode).toBe(200)
    expect(captured.contentType).toBe('text/plain')
    expect(captured.body).toBe(expectedBody)
  })

  it('сырое тело и IP уходят в use-case, а не теряются в контроллере', async () => {
    const seen: unknown[] = []
    const controller = new PaymentsWebhookController(
      {
        execute: async (input: Record<string, unknown>) => {
          seen.push(input)
          return 'OK' as RukassaWebhookReply
        },
      } as unknown as ProcessRukassaWebhookUseCase,
      { execute: async () => ({ ok: true }) } as unknown as ProcessNOWPaymentsWebhookUseCase,
    )

    await controller.rukassaCb(
      { signature: 'b'.repeat(64) },
      { id: '4242' },
      REQUEST,
      fakeResponse({ statusCode: 0, body: '', contentType: '' }) as never,
    )

    expect(seen[0]).toEqual({
      rawHeaders: { signature: 'b'.repeat(64) },
      body: { id: '4242' },
      rawBody: 'amount=3000&id=4242',
      ip: '5.6.7.8',
    })
  })
})
