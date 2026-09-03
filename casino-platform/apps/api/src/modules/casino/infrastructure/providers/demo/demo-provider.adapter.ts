import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  type GameProviderAdapter,
  type LaunchParams,
  type ParsedProviderCallback,
  type ProviderCallbackResponse,
  type ProviderGameRow,
} from '@modules/casino/domain/provider-adapter.interface'

@Injectable()
export class DemoProviderAdapter implements GameProviderAdapter {
  constructor(private config: ConfigService) {}
  async getLaunchUrl(params: LaunchParams): Promise<{ url: string }> {
    const webUrl = this.config.get('APP_URL') || 'http://localhost:3000'
    const url = `${webUrl}/demo-game?token=${encodeURIComponent(params.sessionToken)}&game=${encodeURIComponent(params.gameExternalId)}&currency=${params.currency}&demo=${params.isDemo ? '1' : '0'}`
    return { url }
  }
  async fetchGameList(): Promise<ProviderGameRow[]> {
    return [
      {
        externalGameId: 'demo-sweet-fruits',
        name: 'Sweet Fruits',
        type: 'slot',
        category: 'slots',
        hasDemo: true,
        rtp: 96.5,
      },
      {
        externalGameId: 'demo-lucky-sevens',
        name: 'Lucky Sevens',
        type: 'slot',
        category: 'slots',
        hasDemo: true,
        rtp: 96.0,
      },
      {
        externalGameId: 'demo-book-of-demo',
        name: 'Book of Demo',
        type: 'slot',
        category: 'slots',
        hasDemo: true,
        rtp: 96.21,
      },
    ]
  }
  verifyCallback(): boolean {
    const env = this.config.get('NODE_ENV')
    if (env === 'production') {
      throw new Error('DEMO_PROVIDER_DISABLED. Demo provider cannot be used in production.')
    }
    return true
  }
  parseCallback(_h: Record<string, unknown>, body: Record<string, unknown>): ParsedProviderCallback {
    const opt = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v))
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
