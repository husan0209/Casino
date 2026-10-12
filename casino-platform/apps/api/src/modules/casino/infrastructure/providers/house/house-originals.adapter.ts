import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  type GameProviderAdapter,
  type LaunchParams,
  type ParsedProviderCallback,
  type ProviderCallbackResponse,
  type ProviderGameRow,
} from '@modules/casino/domain/provider-adapter.interface'

/**
 * House-провайдер оригинальных игр (пилот: Fortune Tiger).
 *
 * Фронтенд игры — статика Construct 3 из донора ViperPro-Casino
 * (apps/web/public/house/fortunetiger), серверный протокол — 4 эндпоинта
 * vgames (session/icons/spin/freenum), деньги — через ledger платформы.
 * Внешних HTTP-вызовов адаптер не делает: это seamless-провайдер,
 * у которого «провайдер» — наш собственный API.
 */
@Injectable()
export class HouseOriginalsAdapter implements GameProviderAdapter {
  constructor(@Inject(ConfigService) private config: ConfigService) {}

  async getLaunchUrl(params: LaunchParams): Promise<{ url: string }> {
    const webUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000'
    const gamePath = params.gameExternalId
    const url =
      `${webUrl}/house/${encodeURIComponent(gamePath)}/index.html` +
      `?token=${encodeURIComponent(params.sessionToken)}` +
      `&currency=${encodeURIComponent(params.currency)}`
    return { url }
  }

  async fetchGameList(): Promise<ProviderGameRow[]> {
    return [
      {
        externalGameId: 'fortunetiger',
        name: 'Fortune Tiger',
        type: 'slot',
        category: 'slots',
        thumbnailUrl: '/house/fortunetiger/icons/icon-512.png',
        hasDemo: true,
        rtp: 70,
      },
      {
        externalGameId: 'fortuneox',
        name: 'Fortune Ox',
        type: 'slot',
        category: 'slots',
        thumbnailUrl: '/house/fortuneox/icons/icon-512.png',
        hasDemo: true,
        rtp: 70,
      },
      {
        externalGameId: 'plinko',
        name: 'Plinko',
        type: 'other',
        category: 'instant_games',
        thumbnailUrl: '/house/plinko/thumbnail.svg',
        hasDemo: true,
        rtp: 99,
      },
    ]
  }

  verifyCallback(): boolean {
    return true
  }

  parseCallback(
    _headers: Record<string, unknown>,
    body: Record<string, unknown>,
  ): ParsedProviderCallback {
    const text = (value: unknown): string | undefined =>
      value === undefined || value === null ? undefined : String(value)
    return {
      action: 'balance',
      playerToken: text(body.session_token),
      rawRequest: body,
    }
  }

  formatSuccessResponse(balance: string, transactionId?: string): ProviderCallbackResponse {
    return { success: true, balance, transaction_id: transactionId || null }
  }

  formatErrorResponse(code: string, message: string): ProviderCallbackResponse {
    return { success: false, error: { code, message } }
  }
}
