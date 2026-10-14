import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Res,
  UsePipes,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { type Response } from 'express'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { errorMessage } from '@/common/utils/error-message'

import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type Currency } from '@casino/shared-types'

import {
  OriginalsSessionLoader,
  PLINKO_EXTERNAL_GAME_ID,
} from '../../application/use-cases/originals-session-loader'
import { TIGER_DEMO_START_CREDIT } from '../../application/use-cases/originals-session.use-case'
import {
  PlinkoDropSchema,
  PlinkoDropUseCase,
} from '../../application/use-cases/plinko-drop.use-case'
import { DEMO_BALANCE_STORE, type IDemoBalanceStore } from '../../domain/demo-balance'
import {
  PLINKO_RISK_VALUES,
  PLINKO_ROWS_VALUES,
} from '../../infrastructure/providers/house/spin-data/plinko.tables'

/**
 * Сервер Plinko (house-оригинал).
 *
 * Фронт — адаптированный standalone (apps/web/public/house/plinko),
 * исход дропа решает сервер (CSPRNG-путь + таблицы множителей),
 * анимация только визуализирует готовый path. Токен — sessionToken
 * штатного launch-флоу (capability, как HMAC у внешних провайдеров).
 * Ответы — обычный JSON (наш собственный клиент, не донорный протокол).
 */
@Controller('plinko')
@SkipThrottle()
export class PlinkoController {
  private readonly logger = new Logger(PlinkoController.name)

  constructor(
    @Inject(PlinkoDropUseCase) private readonly dropUseCase: PlinkoDropUseCase,
    @Inject(OriginalsSessionLoader) private readonly sessionLoader: OriginalsSessionLoader,
    @Inject(WalletFacade) private readonly wallet: WalletFacade,
    @Inject(DEMO_BALANCE_STORE) private readonly demoBalance: IDemoBalanceStore,
  ) {}

  @Get(':token/state')
  async state(@Param('token') sessionToken: string, @Res() response: Response): Promise<Response> {
    try {
      // Комплект множителей отдаёт сервер: доска обязана показывать те же
      // числа, по которым идёт расчёт выплаты после смены RTP в админке.
      const tables = await this.dropUseCase.resolvePack(sessionToken)
      if (this.sessionLoader.isDemoToken(sessionToken)) {
        // Остаток — с того же счёта, с которого /drop списывает ставку: токен демо
        // живёт в URL игры, поэтому F5 обязан показать наигранное, а не стартовые 1000.
        const balance = await this.demoBalance.peek(sessionToken, TIGER_DEMO_START_CREDIT)
        return response.json({
          success: true,
          data: {
            balance,
            currency: 'RUB',
            minBet: '1',
            maxBet: '10000',
            risks: PLINKO_RISK_VALUES,
            rowsOptions: PLINKO_ROWS_VALUES,
            tables,
            demo: true,
          },
        })
      }
      const session = await this.sessionLoader.loadActiveHouseSession(
        sessionToken,
        PLINKO_EXTERNAL_GAME_ID,
      )
      const balance = await this.wallet.getBalance(session.userId, session.currency as Currency)
      return response.json({
        success: true,
        data: {
          balance: balance.available,
          currency: session.currency,
          minBet: session.game.minBet ? String(session.game.minBet) : '1',
          maxBet: session.game.maxBet ? String(session.game.maxBet) : '10000',
          risks: PLINKO_RISK_VALUES,
          rowsOptions: PLINKO_ROWS_VALUES,
          tables,
          demo: false,
        },
      })
    } catch (error) {
      return this.handleError(response, error)
    }
  }

  @Post(':token/drop')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(PlinkoDropSchema))
  async drop(
    @Param('token') sessionToken: string,
    @Body() body: { dropId: string; bet: string; risk: string; rows: number },
    @Res() response: Response,
  ): Promise<Response> {
    try {
      const data = await this.dropUseCase.execute({
        sessionToken,
        dropId: body.dropId,
        bet: body.bet,
        risk: body.risk,
        rows: body.rows,
      })
      return response.json({ success: true, data })
    } catch (error) {
      return this.handleError(response, error)
    }
  }

  private handleError(response: Response, error: unknown): Response {
    const message = errorMessage(error) || 'INTERNAL_ERROR'
    const status = this.statusFromError(error)
    if (status >= 500) {
      this.logger.error(`plinko internal error: ${message}`)
      return response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } })
    }
    return response.status(status).json({ success: false, error: { code: message } })
  }

  private statusFromError(error: unknown): number {
    if (error !== null && typeof error === 'object' && 'httpStatus' in error) {
      const httpStatus = (error as { httpStatus: unknown }).httpStatus
      if (typeof httpStatus === 'number') {
        return httpStatus
      }
    }
    return 500
  }
}
