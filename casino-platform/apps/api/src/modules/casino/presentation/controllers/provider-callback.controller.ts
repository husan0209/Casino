import { Body, Controller, Headers, Param, Post, Res, HttpCode } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Response } from 'express'

import { errorMessage } from '@/common/utils/error-message'

import { prisma } from '@casino/database'

import { GameCallbackService } from '../../application/services/game-callback.service'
import { type ParsedProviderCallback } from '../../domain/provider-adapter.interface'
import { ProviderAdapterFactory } from '../../infrastructure/providers/provider-adapter.factory'

/** Доменные ошибки -> коды результата GitSlotPark. */
const CALLBACK_ERROR_CODES: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  SESSION_INVALID: 'SESSION_EXPIRED',
  PLAYER_BLOCKED: 'PLAYER_BLOCKED',
}

// GAP-21 exemption: тело — callback игрового провайдера (формат провайдера,
// подписан токеном/HMAC, который сверяется в use-case). Zod-схема здесь неуместна.
@Controller('provider-callback')
// GAP-19: частые коллбэки от игровых провайдеров (bet/win на каждый спин)
// душатся глобальным лимитом; их аутентификация — подпись/HMAC в сервисе.
@SkipThrottle()
export class ProviderCallbackController {
  constructor(
    private adapters: ProviderAdapterFactory,
    private cb: GameCallbackService,
  ) {}

  @Post(':providerSlug/:op')
  @HttpCode(200)
  async handleOp(
    @Param('providerSlug') slug: string,
    @Param('op') op: string,
    @Headers() headers: any,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    headers['x-gsp-op'] = op
    return this.handle(slug, headers, body, res)
  }

  @Post(':providerSlug')
  @HttpCode(200)
  async handle(
    @Param('providerSlug') slug: string,
    @Headers() headers: any,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    try {
      const adapter = this.adapters.getAdapter(slug)
      if (!adapter.verifyCallback(headers, body)) {
        return res
          .status(200)
          .json(adapter.formatErrorResponse('INVALID_SIGNATURE', 'Invalid signature'))
      }
      const parsed = adapter.parseCallback(headers, body)
      const provider = await prisma.gameProvider.findUnique({ where: { slug } })
      if (!provider) {
        return res
          .status(200)
          .json(adapter.formatErrorResponse('PROVIDER_NOT_FOUND', 'Unknown provider'))
      }
      return await this.dispatch(adapter, parsed, provider.id, res)
    } catch (e) {
      return res.status(200).json({ success: false, error: errorMessage(e) })
    }
  }

  /**
   * Роутинг callback-операции провайдеру. Ответ всегда HTTP 200 — код результата
   * в теле (спека GitSlotPark), иначе провайдер зациклит ретраи.
   */
  private async dispatch(
    adapter: ReturnType<ProviderAdapterFactory['getAdapter']>,
    parsed: ParsedProviderCallback,
    providerId: string,
    res: Response,
  ) {
    try {
      switch (parsed.action) {
        case 'authenticate': {
          const a = await this.cb.authenticate(parsed.playerToken!)
          return res.json({ player_id: a.player_id, balance: a.balance, currency: a.currency })
        }
        case 'balance':
          return res.json(await this.cb.balance(parsed.playerToken!))
        case 'bet': {
          const r = await this.cb.bet(parsed, providerId)
          return res.json(adapter.formatSuccessResponse(r.balance, parsed.transactionId))
        }
        case 'win': {
          const r = await this.cb.win(parsed, providerId)
          return res.json(adapter.formatSuccessResponse(r.balance, parsed.transactionId))
        }
        case 'rollback': {
          const r = await this.cb.rollback(parsed, providerId)
          return res.json(adapter.formatSuccessResponse(r.balance))
        }
        default:
          return res.json(adapter.formatErrorResponse('UNKNOWN_ACTION', 'Unknown action'))
      }
    } catch (e) {
      const msg = errorMessage(e) || 'INTERNAL_ERROR'
      const code = CALLBACK_ERROR_CODES[msg] ?? 'INTERNAL_ERROR'
      return res.json(adapter.formatErrorResponse(code, msg))
    }
  }
}
