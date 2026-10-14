import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  type GameProviderAdapter,
  type LaunchParams,
  type ParsedProviderCallback,
  type ProviderCallbackResponse,
  type ProviderGameRow,
} from '@modules/casino/domain/provider-adapter.interface'

import { HOUSE_SLOT_CATALOG } from './house-slot-games.registry'

/**
 * House-провайдер оригинальных игр (пилот: Fortune Tiger).
 *
 * Фронтенд слотов — статика Construct 3 из донора ViperPro-Casino
 * (apps/web/public/house/fortunetiger), серверный протокол — 4 эндпоинта
 * vgames (session/icons/spin/freenum), деньги — через ledger платформы.
 * Внешних HTTP-вызовов адаптер не делает: это seamless-провайдер,
 * у которого «провайдер» — наш собственный API.
 *
 * Plinko — исключение: самописный клиент и свой протокол (/api/plinko).
 */
const HOUSE_PLINKO_GAME_ROW: ProviderGameRow = {
  externalGameId: 'plinko',
  name: 'Plinko',
  type: 'other',
  category: 'instant_games',
  thumbnailUrl: '/house/plinko/cover.jpg',
  hasDemo: true,
  rtp: 99,
}

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
      ...HOUSE_SLOT_CATALOG.map((config) => ({
        externalGameId: config.externalGameId,
        name: config.displayName,
        type: 'slot',
        category: 'slots',
        // `cover.jpg` — обложка игры, она в индексе. `icons/icon-512.png` из
        // донорского экспорта Construct — это заглушка движка (один и тот же знак
        // на всех слотах), на витрине все 11 игр выглядели одинаково.
        thumbnailUrl: `/house/${config.externalGameId}/cover.jpg`,
        hasDemo: true,
        rtp: Number(config.defaultRtp),
      })),
      HOUSE_PLINKO_GAME_ROW,
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
