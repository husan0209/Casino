import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GameProviderAdapter } from '../../domain/provider-adapter.interface'
import { DemoProviderAdapter } from './demo/demo-provider.adapter'
import { ProviderNotSupportedError } from '../../domain/errors'

@Injectable()
export class ProviderAdapterFactory {
  private readonly logger = new Logger(ProviderAdapterFactory.name)

  constructor(private config: ConfigService) {}

  getAdapter(slug: string): GameProviderAdapter {
    switch (slug) {
      case 'demo-provider': {
        const env = this.config.get('NODE_ENV')
        const demoEnabled = this.config.get('DEMO_PROVIDER_ENABLED')

        if (env === 'production') {
          this.logger.error('Demo provider requested in production. DEMO_PROVIDER_DISABLED.')
          throw new Error('DEMO_PROVIDER_DISABLED. Demo provider is not available in production.')
        }

        if (!demoEnabled) {
          this.logger.warn('Demo provider requested but DEMO_PROVIDER_ENABLED=false')
          throw new Error('DEMO_PROVIDER_DISABLED. Demo provider is disabled.')
        }

        return new DemoProviderAdapter(this.config)
      }
      // case 'pragmatic-play': return new PragmaticPlayAdapter(...)
      // case 'evolution': return new EvolutionAdapter(...)
      // case 'bgaming': return new BGamingAdapter(...)
      default: throw new ProviderNotSupportedError(slug)
    }
  }
}
