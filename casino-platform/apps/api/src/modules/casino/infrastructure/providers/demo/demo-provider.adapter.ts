import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  type GameProviderAdapter,
  type LaunchParams,
  type ParsedProviderCallback,
} from '@modules/casino/domain/provider-adapter.interface'

@Injectable()
export class DemoProviderAdapter implements GameProviderAdapter {
  constructor(private config: ConfigService) {}
  async getLaunchUrl(params: LaunchParams) {
    const webUrl = this.config.get('APP_URL') || 'http://localhost:3000'
    const url = `${webUrl}/demo-game?token=${encodeURIComponent(params.sessionToken)}&game=${encodeURIComponent(params.gameExternalId)}&currency=${params.currency}&demo=${params.isDemo ? '1' : '0'}`
    return { url }
  }
  async fetchGameList() {
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
  verifyCallback() {
    const env = this.config.get('NODE_ENV')
    if (env === 'production') {
      throw new Error('DEMO_PROVIDER_DISABLED. Demo provider cannot be used in production.')
    }
    return true
  }
  parseCallback(_h: Record<string, unknown>, body: Record<string, unknown>): ParsedProviderCallback {
    return {
      action: body.action,
      playerToken: body.player_token || body.session_token,
      betAmount: body.amount ? String(body.amount) : undefined,
      winAmount: body.amount ? String(body.amount) : undefined,
      roundId: body.round_id,
      transactionId: body.transaction_id,
      rollbackTransactionId: body.rollback_transaction_id,
      gameId: body.game_id,
      currency: body.currency,
      rawRequest: body,
    }
  }
  formatSuccessResponse(balance: string, transactionId?: string) {
    return { success: true, balance, transaction_id: transactionId || null }
  }
  formatErrorResponse(code: string, message: string) {
    return { success: false, error: { code, message } }
  }
}
