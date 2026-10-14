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

import { successResponse } from '@casino/shared-utils'

import { AztecSpinSchema, AztecSpinUseCase } from '../../application/use-cases/aztec-spin.use-case'

/**
 * Сервер Aztec (house-оригинал с собственной математикой).
 *
 * Клиент — свой, не Construct-экспорт донора, поэтому ответы идут штатным
 * конвертом successResponse, а не сырой формой донора. Цепочку каскадов
 * решает сервер (CSPRNG + domain/aztec-game), фронт только проигрывает её
 * по шагам и показывает тот же хеш исхода, что записан в ledger.
 */
@Controller('aztec')
@SkipThrottle()
export class AztecController {
  private readonly logger = new Logger(AztecController.name)

  constructor(@Inject(AztecSpinUseCase) private readonly spinUseCase: AztecSpinUseCase) {}

  @Get(':token/state')
  async state(@Param('token') sessionToken: string, @Res() response: Response): Promise<Response> {
    try {
      const data = await this.spinUseCase.state(sessionToken)
      return response.json(successResponse(data))
    } catch (error) {
      return this.handleError(response, error)
    }
  }

  @Post(':token/spin')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(AztecSpinSchema))
  async spin(
    @Param('token') sessionToken: string,
    @Body() body: { spinId: string; bet: string },
    @Res() response: Response,
  ): Promise<Response> {
    try {
      const data = await this.spinUseCase.execute({
        sessionToken,
        spinId: body.spinId,
        bet: body.bet,
      })
      return response.json(successResponse(data))
    } catch (error) {
      return this.handleError(response, error)
    }
  }

  private handleError(response: Response, error: unknown): Response {
    const message = errorMessage(error) || 'INTERNAL_ERROR'
    const status = this.statusFromError(error)
    if (status >= 500) {
      this.logger.error(`aztec internal error: ${message}`)
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
