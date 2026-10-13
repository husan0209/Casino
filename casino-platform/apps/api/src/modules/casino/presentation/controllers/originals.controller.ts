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

import { OriginalsIconsUseCase } from '../../application/use-cases/originals-icons.use-case'
import { OriginalsSessionUseCase } from '../../application/use-cases/originals-session.use-case'
import {
  OriginalsSpinSchema,
  OriginalsSpinUseCase,
} from '../../application/use-cases/originals-spin.use-case'
import { OriginalsActionNotSupportedError } from '../../domain/errors'

/**
 * Серверный протокол house-оригиналов (пилот: Fortune Tiger).
 *
 * Фронт Construct 3 из донора ViperPro-Casino ходит относительными путями
 * /api/vgames/{token}/{action} (режим apiFramework=laravel, apiURL=/api/vgames):
 * GET session/icons, POST spin (x-www-form-urlencoded), POST freenum.
 * Токен — sessionToken штатного launch-флоу (capability, как HMAC у внешних
 * провайдеров), поэтому AuthGuard здесь нет — как и Zod на signed-callbacks.
 *
 * Ответы — сырая форма донора {success, data, message} (НЕ successResponse):
 * фиксированный внешний клиент, прецедент — provider-callback.controller.
 * Ошибки наружу — только коды AppError, тексты Prisma/пути — в лог (GAP-57).
 */
@Controller('vgames')
@SkipThrottle()
export class OriginalsController {
  private readonly logger = new Logger(OriginalsController.name)

  constructor(
    @Inject(OriginalsSessionUseCase) private readonly sessionUseCase: OriginalsSessionUseCase,
    @Inject(OriginalsIconsUseCase) private readonly iconsUseCase: OriginalsIconsUseCase,
    @Inject(OriginalsSpinUseCase) private readonly spinUseCase: OriginalsSpinUseCase,
  ) {}

  @Get(':token/session')
  async session(
    @Param('token') sessionToken: string,
    @Res() response: Response,
  ): Promise<Response> {
    try {
      const data = await this.sessionUseCase.execute(sessionToken)
      return response.json({ data, success: true, message: 'Session success' })
    } catch (error) {
      return this.handleError(response, error)
    }
  }

  @Get(':token/icons')
  async icons(@Param('token') sessionToken: string, @Res() response: Response): Promise<Response> {
    try {
      return response.json(await this.iconsUseCase.execute(sessionToken))
    } catch (error) {
      return this.handleError(response, error)
    }
  }

  @Post(':token/spin')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(OriginalsSpinSchema))
  async spin(
    @Param('token') sessionToken: string,
    @Body() body: { betamount: string; numline: string; cpl: string },
    @Res() response: Response,
  ): Promise<Response> {
    try {
      const data = await this.spinUseCase.execute({
        sessionToken,
        betamount: body.betamount,
        numline: body.numline,
        cpl: body.cpl,
      })
      return response.json({ data, success: true, message: 'Spin success' })
    } catch (error) {
      return this.handleError(response, error)
    }
  }

  @Post(':token/freenum')
  @HttpCode(200)
  async freenum(@Res() response: Response): Promise<Response> {
    return this.handleError(response, new OriginalsActionNotSupportedError('freenum'))
  }

  private handleError(response: Response, error: unknown): Response {
    const message = errorMessage(error) || 'INTERNAL_ERROR'
    const status = this.statusFromError(error)
    if (status >= 500) {
      this.logger.error(`originals internal error: ${message}`)
      return response.status(500).json({ success: false, message: 'INTERNAL_ERROR' })
    }
    return response.status(status).json({ success: false, message })
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
