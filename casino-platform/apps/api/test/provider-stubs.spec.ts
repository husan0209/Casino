import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConfigService } from '@nestjs/config'

import { RukassaClient } from '../src/modules/payments/infrastructure/clients/rukassa.client'
import { NOWPaymentsClient } from '../src/modules/payments/infrastructure/clients/nowpayments.client'
import { DemoProviderAdapter } from '../src/modules/casino/infrastructure/providers/demo/demo-provider.adapter'
import { ProviderAdapterFactory } from '../src/modules/casino/infrastructure/providers/provider-adapter.factory'

/**
 * Прямое инстанцирование вместо DI (@nestjs/testing): тест проверяет
 * поведение клиентов, а не сборку зависимостей. Утверждения актуализированы
 * под fail-closed реализацию (клиенты бросают ошибку отсутствующих ключей
 * в проде — см. историю PR-0): jest.spyOn → vi.spyOn (проект на vitest).
 */
describe('Provider Stubs Security', () => {
  let config: ConfigService
  let rukassaClient: RukassaClient
  let nowpaymentsClient: NOWPaymentsClient
  let demoAdapter: DemoProviderAdapter
  let factory: ProviderAdapterFactory

  beforeEach(() => {
    config = new ConfigService()
    rukassaClient = new RukassaClient(config)
    nowpaymentsClient = new NOWPaymentsClient(config)
    demoAdapter = new DemoProviderAdapter(config)
    factory = new ProviderAdapterFactory(config)
  })

  describe('Rukassa Client', () => {
    it('fails closed in production when keys are not configured', async () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        return undefined
      })

      await expect(
        rukassaClient.createPayment({
          amount: '100',
          orderId: 'order_1',
          method: 'card',
          webhookUrl: 'http://localhost/webhook',
          successUrl: 'http://localhost/success',
          failUrl: 'http://localhost/fail',
        }),
      ).rejects.toThrow(/обязательные ключи/)
    })

    it('fails closed in production when verifying callback without secret', () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        return undefined
      })

      expect(() =>
        rukassaClient.verifyCallback({}, { order_id: '123', amount: '100' }),
      ).toThrow(/обязательные ключи/)
    })

    it('returns false in development when secret is not configured', () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development'
        if (key === 'RUKASSA_SECRET_KEY') return undefined
        return undefined
      })

      const result = rukassaClient.verifyCallback(
        {},
        { order_id: '123', amount: '100' },
      )

      expect(result).toBe(false)
    })
  })

  describe('NOWPayments Client', () => {
    it('fails closed in production when keys are not configured', async () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        return undefined
      })

      await expect(
        nowpaymentsClient.createPayment({
          priceAmount: '100',
          priceCurrency: 'RUB',
          payCurrency: 'USDT_TRC20',
          orderId: 'order_1',
          ipnCallbackUrl: 'http://localhost/webhook',
        }),
      ).rejects.toThrow(/обязательные ключи/)
    })

    it('fails closed in production when verifying IPN without secret', () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        return undefined
      })

      expect(() =>
        nowpaymentsClient.verifyIPN(
          { order_id: '123', amount: '100' },
          'fake_signature',
        ),
      ).toThrow(/обязательные ключи/)
    })

    it('returns false in development when secret is not configured', () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development'
        if (key === 'NOWPAYMENTS_IPN_SECRET') return undefined
        return undefined
      })

      const result = nowpaymentsClient.verifyIPN(
        { order_id: '123', amount: '100' },
        'fake_signature',
      )

      expect(result).toBe(false)
    })
  })

  describe('Demo Provider Adapter', () => {
    it('throws in production when verifying callback', () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        return undefined
      })

      expect(() => demoAdapter.verifyCallback()).toThrow('DEMO_PROVIDER_DISABLED')
    })

    it('returns true in development', () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development'
        return undefined
      })

      const result = demoAdapter.verifyCallback()
      expect(result).toBe(true)
    })
  })

  describe('Provider Adapter Factory', () => {
    it('throws when requesting demo provider in production', () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        if (key === 'DEMO_PROVIDER_ENABLED') return false
        return undefined
      })

      expect(() => factory.getAdapter('demo-provider')).toThrow(
        'DEMO_PROVIDER_DISABLED',
      )
    })

    it('throws when demo provider is disabled', () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development'
        if (key === 'DEMO_PROVIDER_ENABLED') return false
        return undefined
      })

      expect(() => factory.getAdapter('demo-provider')).toThrow(
        'DEMO_PROVIDER_DISABLED',
      )
    })

    it('returns demo adapter when enabled in development', () => {
      vi.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development'
        if (key === 'DEMO_PROVIDER_ENABLED') return true
        return undefined
      })

      const adapter = factory.getAdapter('demo-provider')
      expect(adapter).toBeInstanceOf(DemoProviderAdapter)
    })
  })
})
