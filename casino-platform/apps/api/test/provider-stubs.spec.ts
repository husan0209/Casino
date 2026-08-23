import { Test, TestingModule } from '@nestjs/testing'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { RukassaClient } from '../src/modules/payments/infrastructure/clients/rukassa.client'
import { NOWPaymentsClient } from '../src/modules/payments/infrastructure/clients/nowpayments.client'
import { DemoProviderAdapter } from '../src/modules/casino/infrastructure/providers/demo/demo-provider.adapter'
import { ProviderAdapterFactory } from '../src/modules/casino/infrastructure/providers/provider-adapter.factory'

describe('Provider Stubs Security', () => {
  let app: TestingModule
  let config: ConfigService
  let rukassaClient: RukassaClient
  let nowpaymentsClient: NOWPaymentsClient
  let demoAdapter: DemoProviderAdapter
  let factory: ProviderAdapterFactory

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
      ],
      providers: [RukassaClient, NOWPaymentsClient, DemoProviderAdapter, ProviderAdapterFactory],
    }).compile()

    config = app.get(ConfigService)
    rukassaClient = app.get(RukassaClient)
    nowpaymentsClient = app.get(NOWPaymentsClient)
    demoAdapter = app.get(DemoProviderAdapter)
    factory = app.get(ProviderAdapterFactory)
  })

  describe('Rukassa Client', () => {
    it('throws in production when creating payment', async () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
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
      ).rejects.toThrow('RUKASSA_CREATE_PAYMENT_NOT_IMPLEMENTED')
    })

    it('throws in production when verifying callback', () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        return undefined
      })

      expect(() =>
        rukassaClient.verifyCallback({}, { order_id: '123', amount: '100' }),
      ).toThrow('RUKASSA_SIGNATURE_VERIFIER_NOT_IMPLEMENTED')
    })

    it('returns false in development when secret is not configured', () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
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
    it('throws in production when creating payment', async () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
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
      ).rejects.toThrow('NOWPAYMENTS_CREATE_PAYMENT_NOT_IMPLEMENTED')
    })

    it('throws in production when verifying IPN', () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        return undefined
      })

      expect(() =>
        nowpaymentsClient.verifyIPN(
          { order_id: '123', amount: '100' },
          'fake_signature',
        ),
      ).toThrow('NOWPAYMENTS_SIGNATURE_VERIFIER_NOT_IMPLEMENTED')
    })

    it('returns false in development when secret is not configured', () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
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
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        return undefined
      })

      expect(() => demoAdapter.verifyCallback()).toThrow('DEMO_PROVIDER_DISABLED')
    })

    it('returns true in development', () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development'
        return undefined
      })

      const result = demoAdapter.verifyCallback()
      expect(result).toBe(true)
    })
  })

  describe('Provider Adapter Factory', () => {
    it('throws when requesting demo provider in production', () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production'
        if (key === 'DEMO_PROVIDER_ENABLED') return false
        return undefined
      })

      expect(() => factory.getAdapter('demo-provider')).toThrow(
        'DEMO_PROVIDER_DISABLED',
      )
    })

    it('throws when demo provider is disabled', () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development'
        if (key === 'DEMO_PROVIDER_ENABLED') return false
        return undefined
      })

      expect(() => factory.getAdapter('demo-provider')).toThrow(
        'DEMO_PROVIDER_DISABLED',
      )
    })

    it('returns demo adapter when enabled in development', () => {
      jest.spyOn(config, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development'
        if (key === 'DEMO_PROVIDER_ENABLED') return true
        return undefined
      })

      const adapter = factory.getAdapter('demo-provider')
      expect(adapter).toBeInstanceOf(DemoProviderAdapter)
    })
  })
})
