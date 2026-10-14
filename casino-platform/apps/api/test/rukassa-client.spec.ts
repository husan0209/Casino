/**
 * Контрактный тест Rukassa-клиента (lk.rukassa.io/api/v1, страница «Разработчикам»).
 *
 * Проверяем ровно то, на чём интеграция ломается при расхождении с документацией:
 * эндпоинт, form-urlencoded, имена полей авторизации, разбор отказа и подпись
 * уведомления (golden-вектор HMAC-SHA256 с ключом = API-токен).
 * fetch мокается: сеть в юните не нужна.
 */
import { createHmac } from 'crypto'

import { ConfigService } from '@nestjs/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RukassaClient } from '../src/modules/payments/infrastructure/clients/rukassa.client'

const TOKEN = 'test-token-123'
const SHOP = '777'

/** form-urlencoded тело запроса -> объект для утверждений по полям. */
function formFieldsOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(init.body)))
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeClient(overrides: Record<string, string | undefined> = {}): RukassaClient {
  const values: Record<string, string | undefined> = {
    NODE_ENV: 'production',
    RUKASSA_SHOP_ID: SHOP,
    RUKASSA_API_KEY: TOKEN,
    ...overrides,
  }
  const config = new ConfigService()
  vi.spyOn(config, 'get').mockImplementation((key: string) => values[key])
  return new RukassaClient(config)
}

/** Золотой вектор их примера: hash_hmac('sha256', id|createdDateTime|amount, token). */
function sign(id: string, createdDateTime: string, amount: string, token = TOKEN): string {
  return createHmac('sha256', token).update(`${id}|${createdDateTime}|${amount}`).digest('hex')
}

describe('RukassaClient — контракт lk.rukassa.io', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  describe('createPayment', () => {
    it('шлёт form-urlencoded на /api/v1/create с shop_id и token в теле', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ id: 42, hash: 'h', url: 'https://lk.rukassa.io/pay/42' }),
      )
      const client = makeClient()

      const res = await client.createPayment({
        amount: '300',
        orderId: '1750000000000001',
        data: '{"payment_request_id":"pr-1"}',
        method: 'sbp',
        currency: 'RUB',
      })

      expect(fetchMock.mock.calls[0]![0]).toBe('https://lk.rukassa.io/api/v1/create')
      const init = fetchMock.mock.calls[0]![1] as RequestInit
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      )
      expect(formFieldsOf(init)).toEqual({
        shop_id: SHOP,
        // Присутствие `user_code` обязательно: без него живой /create отвечает
        // 403 «error user_code», хотя значение они не сверяют (проверено 1 и
        // 999999 — оба проходят). В /getPayInfo поле не нужно.
        user_code: SHOP,
        token: TOKEN,
        order_id: '1750000000000001',
        amount: '300',
        currency: 'RUB',
        data: '{"payment_request_id":"pr-1"}',
        method: 'sbp',
      })
      expect(res).toEqual({ paymentId: '42', paymentUrl: 'https://lk.rukassa.io/pay/42' })
    })

    it('не отправляет метод, которого нет у Rukassa (наше p2p) — форма покажет включённые', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 43, url: 'https://lk.rukassa.io/pay/43' }))

      await makeClient().createPayment({
        amount: '100',
        orderId: '1',
        data: '{}',
        method: 'p2p',
      })

      const fields = formFieldsOf(fetchMock.mock.calls[0]![1] as RequestInit)
      expect(fields.method).toBeUndefined()
    })

    it('не подставляет метод по умолчанию, если он не передан', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 44, url: 'u' }))

      await makeClient().createPayment({ amount: '100', orderId: '2', data: '{}' })

      const fields = formFieldsOf(fetchMock.mock.calls[0]![1] as RequestInit)
      expect(fields.method).toBeUndefined()
      expect(fields.currency).toBe('RUB')
    })

    it('их отказ { error, message } -> PaymentProviderError с текстом провайдера', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 403, message: 'Метод отключён' }))

      await expect(
        makeClient().createPayment({ amount: '100', orderId: '3', data: '{}' }),
      ).rejects.toThrow(/Метод отключён/)
    })

    it('error: 0 или false рядом с id/url — это успех, а не отказ', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ id: 55, url: 'https://lk.rukassa.io/pay/55', error: 0 }),
      )
      expect(
        await makeClient().createPayment({ amount: '100', orderId: '30', data: '{}' }),
      ).toEqual({ paymentId: '55', paymentUrl: 'https://lk.rukassa.io/pay/55' })

      fetchMock.mockResolvedValue(jsonResponse({ id: 56, url: 'u', error: false }))
      expect(
        await makeClient().createPayment({ amount: '100', orderId: '31', data: '{}' }),
      ).toEqual({ paymentId: '56', paymentUrl: 'u' })
    })

    it('ответ без id/url — не угадываем форму, а падаем', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))

      await expect(
        makeClient().createPayment({ amount: '100', orderId: '4', data: '{}' }),
      ).rejects.toThrow(/unexpected response shape/)
    })

    it('HTTP-ошибка провайдера пробрасывается как PaymentProviderError', async () => {
      fetchMock.mockResolvedValue(new Response('gateway blocked', { status: 403 }))

      await expect(
        makeClient().createPayment({ amount: '100', orderId: '5', data: '{}' }),
      ).rejects.toThrow(/HTTP 403/)
    })

    it('эхо провайдера с токеном не уходит в текст ошибки', async () => {
      fetchMock.mockResolvedValue(new Response(`notice: token=${TOKEN} invalid`, { status: 400 }))

      const error = await makeClient()
        .createPayment({ amount: '100', orderId: '7', data: '{}' })
        .then(() => null)
        .catch((e: Error) => e)

      expect(error?.message).toContain('[redacted]')
      expect(error?.message).not.toContain(TOKEN)
    })

    it('в dev без ключей — стаб, без обращения к провайдеру', async () => {
      const client = makeClient({ NODE_ENV: 'development', RUKASSA_SHOP_ID: undefined })

      const res = await client.createPayment({ amount: '100', orderId: '6', data: '{}' })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(res.paymentId).toBe('rk_6')
      // deposit=pending — значение, которое понимает наш DepositReturnHandler:
      // локальный флоу должен поллить статус, а не упереться в неизвестный параметр.
      expect(res.paymentUrl).toBe('http://localhost:3000/wallet?deposit=pending')
    })
  })

  describe('getPaymentStatus', () => {
    it('запрос на /api/v1/getPayInfo и статус их enum', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 42, amount: '300', status: 'PAID' }))

      const res = await makeClient().getPaymentStatus('42')

      expect(fetchMock.mock.calls[0]![0]).toBe('https://lk.rukassa.io/api/v1/getPayInfo')
      // user_code здесь не нужен — проверено живым запросом к их счёту: ответ 200
      // и без поля. Требование на присутствие касается только /create.
      expect(formFieldsOf(fetchMock.mock.calls[0]![1] as RequestInit)).toEqual({
        shop_id: SHOP,
        token: TOKEN,
        id: '42',
      })
      expect(res).toEqual({ status: 'PAID', amount: '300' })
    })

    it('сумма для сверки — фактическая: in_amount важнее заявленной amount', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ id: 42, amount: '300', in_amount: '250', status: 'PAID' }),
      )

      expect(await makeClient().getPaymentStatus('42')).toEqual({ status: 'PAID', amount: '250' })
    })

    it('база берётся из RUKASSA_API_BASE', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'WAIT', amount: '1' }))

      await makeClient({ RUKASSA_API_BASE: 'https://mirror.example' }).getPaymentStatus('9')

      expect(fetchMock.mock.calls[0]![0]).toBe('https://mirror.example/api/v1/getPayInfo')
    })
  })

  describe('verifyCallback — подпись уведомления', () => {
    const body = { id: '42', createdDateTime: '2026-10-12T10:00:00Z', amount: '300' }

    it('принимает корректную подпись в заголовке signature', () => {
      const client = makeClient()
      const headers = { signature: sign('42', '2026-10-12T10:00:00Z', '300') }

      expect(headers.signature).toBe(
        '04a99b261903ace549f315b7221a7ae5d2bce90b580e0729997cc8b236ae5ff9',
      )
      expect(client.verifyCallback(headers, body)).toBe(true)
    })

    it('ключ — API-токен: с другим токеном подпись не проходит', () => {
      const headers = { signature: sign('42', '2026-10-12T10:00:00Z', '300', 'other-token') }

      expect(makeClient().verifyCallback(headers, body)).toBe(false)
    })

    it('подпись по другой склейке полей не проходит', () => {
      const headers = { signature: sign('42', '300', '2026-10-12T10:00:00Z') }

      expect(makeClient().verifyCallback(headers, body)).toBe(false)
    })

    it('без заголовка signature и с мусорным значением — false', () => {
      const client = makeClient()

      expect(client.verifyCallback({}, body)).toBe(false)
      expect(client.verifyCallback({ signature: 'not-hex' }, body)).toBe(false)
      expect(client.verifyCallback({ signature: 'ab' }, body)).toBe(false)
    })

    it('подмена суммы после подписи разваливается', () => {
      const headers = { signature: sign('42', '2026-10-12T10:00:00Z', '300') }

      expect(makeClient().verifyCallback(headers, { ...body, amount: '1' })).toBe(false)
    })
  })
})
