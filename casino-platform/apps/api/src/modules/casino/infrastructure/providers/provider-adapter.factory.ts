import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GameProviderAdapter } from '../../domain/provider-adapter.interface'
import { DemoProviderAdapter } from './demo/demo-provider.adapter'
import { ProviderNotSupportedError } from '../../domain/errors'
@Injectable()
export class ProviderAdapterFactory {
  constructor(private config: ConfigService) {}
  getAdapter(slug: string): GameProviderAdapter {
    switch (slug) {
      case 'demo-provider': return new DemoProviderAdapter(this.config)
      // case 'pragmatic-play': return new PragmaticPlayAdapter(...)
      // case 'evolution': return new EvolutionAdapter(...)
      // case 'bgaming': return new BGamingAdapter(...)
      default: throw new ProviderNotSupportedError(slug)
    }
  }
}
