import { Body, Controller, Headers, Param, Post, Res, HttpCode } from '@nestjs/common'
import type { Response } from 'express'
import { ProviderAdapterFactory } from '../../infrastructure/providers/provider-adapter.factory'
import { GameCallbackService } from '../../application/services/game-callback.service'
import { prisma } from '@casino/database'

@Controller('provider-callback')
export class ProviderCallbackController {
  constructor(private adapters: ProviderAdapterFactory, private cb: GameCallbackService) {}

  @Post(':providerSlug')
  @HttpCode(200)
  async handle(@Param('providerSlug') slug: string, @Headers() headers: any, @Body() body: any, @Res() res: Response) {
    try {
      const adapter = this.adapters.getAdapter(slug)
      if (!adapter.verifyCallback(headers, body)) {
        return res.status(200).json(adapter.formatErrorResponse('INVALID_SIGNATURE', 'Invalid signature'))
      }
      const parsed = adapter.parseCallback(headers, body)
      const provider = await prisma.gameProvider.findUnique({ where: { slug }})
      if (!provider) return res.status(200).json(adapter.formatErrorResponse('PROVIDER_NOT_FOUND', 'Unknown provider'))
      let result: any
      try {
        switch (parsed.action) {
          case 'authenticate': {
            const a = await this.cb.authenticate(parsed.playerToken!)
            return res.json({ player_id: a.player_id, balance: a.balance, currency: a.currency })
          }
          case 'balance': {
            const b = await this.cb.balance(parsed.playerToken!)
            return res.json(b)
          }
          case 'bet': {
            result = await this.cb.bet(parsed, provider.id)
            return res.json(adapter.formatSuccessResponse(result.balance, parsed.transactionId))
          }
          case 'win': {
            result = await this.cb.win(parsed, provider.id)
            return res.json(adapter.formatSuccessResponse(result.balance, parsed.transactionId))
          }
          case 'rollback': {
            result = await this.cb.rollback(parsed, provider.id)
            return res.json(adapter.formatSuccessResponse(result.balance))
          }
          default:
            return res.json(adapter.formatErrorResponse('UNKNOWN_ACTION', 'Unknown action'))
        }
      } catch (e:any) {
        const msg = e?.message || 'INTERNAL_ERROR'
        const map: Record<string,string> = {
          INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
          SESSION_INVALID: 'SESSION_EXPIRED',
          PLAYER_BLOCKED: 'PLAYER_BLOCKED',
        }
        const code = map[msg] || 'INTERNAL_ERROR'
        return res.json(adapter.formatErrorResponse(code, msg))
      }
    } catch (e:any) {
      return res.status(200).json({ success: false, error: e.message })
    }
  }
}
