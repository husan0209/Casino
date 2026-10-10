import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  type GameProviderAdapter,
  type LaunchParams,
  type ParsedProviderCallback,
  type ProviderCallbackResponse,
  type ProviderGameRow,
} from '@modules/casino/domain/provider-adapter.interface'

import { DEMO_GAMES } from '@casino/database'

import { DemoProviderDisabledError } from '../../../domain/errors'

@Injectable()
export class DemoProviderAdapter implements GameProviderAdapter {
  constructor(@Inject(ConfigService) private config: ConfigService) {}
  async getLaunchUrl(params: LaunchParams): Promise<{ url: string }> {
    const webUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000'
    const url = `${webUrl}/demo-game?token=${encodeURIComponent(params.sessionToken)}&game=${encodeURIComponent(params.gameExternalId)}&currency=${params.currency}&demo=${params.isDemo ? '1' : '0'}`
    return { url }
  }
  /**
   * Каталог демо-провайдера — из того же списка, что и сид
   * (`DEMO_GAMES` в @casino/database): сид заводит карточки витрины, отсюда их
   * берёт синхронизация каталога в админке.
   */
  async fetchGameList(): Promise<ProviderGameRow[]> {
    return DEMO_GAMES.map((game) => ({
      externalGameId: game.slug,
      name: game.name,
      type: 'slot' as const,
      category: 'slots',
      hasDemo: true,
      rtp: game.rtp,
    }))
  }
  verifyCallback(): boolean {
    const env = this.config.get<string>('NODE_ENV')
    if (env === 'production') {
      throw new DemoProviderDisabledError(
        'DEMO_PROVIDER_DISABLED. Demo provider cannot be used in production.',
      )
    }
    return true
  }
  parseCallback(
    _h: Record<string, unknown>,
    body: Record<string, unknown>,
  ): ParsedProviderCallback {
    const opt = (v: unknown): string | undefined =>
      v === undefined || v === null ? undefined : String(v)
    return {
      action: body.action as ParsedProviderCallback['action'],
      playerToken: opt(body.player_token ?? body.session_token),
      betAmount: body.amount !== undefined ? String(body.amount) : undefined,
      winAmount: body.amount !== undefined ? String(body.amount) : undefined,
      roundId: opt(body.round_id),
      transactionId: opt(body.transaction_id),
      rollbackTransactionId: opt(body.rollback_transaction_id),
      gameId: opt(body.game_id),
      currency: opt(body.currency),
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
