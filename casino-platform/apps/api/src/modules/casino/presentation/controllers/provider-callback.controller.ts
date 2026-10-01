import { Body, Controller, Headers, Inject, Logger, Param, Post, Res, HttpCode } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { type Response } from 'express'

import { errorMessage } from '@/common/utils/error-message'

import { prisma } from '@casino/database'


import { GameCallbackService } from '../../application/services/game-callback.service'
import { IProviderAdapterFactory, PROVIDER_ADAPTER_FACTORY } from '../../domain/casino.ports'
import { type ParsedProviderCallback } from '../../domain/provider-adapter.interface'

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
  private readonly logger = new Logger(ProviderCallbackController.name)

  constructor(
    @Inject(PROVIDER_ADAPTER_FACTORY) private adapters: IProviderAdapterFactory,
    private cb: GameCallbackService,
  ) {}

  @Post(':providerSlug/:op')
  @HttpCode(200)
  async handleOp(
    @Param('providerSlug') slug: string,
    @Param('op') op: string,
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<Response> {
    headers['x-gsp-op'] = op
    return this.handle(slug, headers, body, res)
  }

  @Post(':providerSlug')
  @HttpCode(200)
  async handle(
    @Param('providerSlug') slug: string,
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<Response> {
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
      // GAP-57: наружу — только нейтральное тело; полный текст (Prisma, пути
      // машины) остаётся в серверном логе.
      this.logger.error(`provider-callback handle error: ${errorMessage(e)}`)
      return res.status(200).json({ success: false, error: 'INTERNAL_ERROR' })
    }
  }

  /**
   * Роутинг callback-операции провайдеру. Ответ всегда HTTP 200 — код результата
   * в теле (спека GitSlotPark), иначе провайдер зациклит ретраи.
   */
  private async dispatch(
    adapter: ReturnType<IProviderAdapterFactory['getAdapter']>,
    parsed: ParsedProviderCallback,
    providerId: string,
    res: Response,
  ): Promise<Response> {
    try {
      switch (parsed.action) {
        case 'authenticate': {
          const a = await this.cb.authenticate(parsed.playerToken!)
          return res.json({ player_id: a.player_id, balance: a.balance, currency: a.currency })
        }
        case 'balance':
          return res.json(await this.cb.balance(parsed.playerToken!))
        case 'bet': {
          const r = (await this.cb.bet(parsed, providerId)) as { balance: string }
          return res.json(adapter.formatSuccessResponse(r.balance, parsed.transactionId))
        }
        case 'win': {
          const r = (await this.cb.win(parsed, providerId)) as { balance: string }
          return res.json(adapter.formatSuccessResponse(r.balance, parsed.transactionId))
        }
        case 'rollback': {
          const r = (await this.cb.rollback(parsed, providerId)) as { balance: string }
          return res.json(adapter.formatSuccessResponse(r.balance))
        }
        default:
          return res.json(adapter.formatErrorResponse('UNKNOWN_ACTION', 'Unknown action'))
      }
    } catch (e) {
      const msg = errorMessage(e) || 'INTERNAL_ERROR'
      const code = CALLBACK_ERROR_CODES[msg]
      // GAP-57 (найдено прогоном GAP-47, 2026-09-27): наружу — только известные
      // доменные коды; всё остальное (текст Prisma-инвокаций, пути машины)
      // остаётся в серверном логе, а провайдеру уходит нейтральный
      // INTERNAL_ERROR. Раньше текст сырой Prisma-ошибки утекал провайдеру.
      if (!code) {
        this.logger.error(`provider-callback internal error: ${msg}`)
        return res.json(adapter.formatErrorResponse('INTERNAL_ERROR', 'INTERNAL_ERROR'))
      }
      return res.json(adapter.formatErrorResponse(code, msg))
    }
  }
}
