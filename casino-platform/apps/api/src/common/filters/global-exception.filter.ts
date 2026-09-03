import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { type Request, type Response } from 'express'
import { PinoLogger } from 'nestjs-pino'

import { AppError, errorResponse } from '@casino/shared-utils'

/** message из Nest- response-объекта (валидация отдаёт массив строк). */
function payloadMessage(res: unknown, fallback: string): unknown {
  if (typeof res === 'object' && res !== null && 'message' in res) {
    return (res as { message: unknown }).message
  }
  return fallback
}

/** Стабильный UPPER_SNAKE код из поля error (BadRequestException -> BAD_REQUEST). */
function payloadCode(res: unknown): string {
  if (typeof res === 'object' && res !== null && 'error' in res) {
    return String((res as { error: unknown }).error)
      .toUpperCase()
      .replace(/\s+/g, '_')
  }
  return 'HTTP_ERROR'
}

/** details: массив ошибок валидации — под ключом validation, иначе весь payload. */
function payloadDetails(res: unknown, message: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(message)) {
    return { validation: message }
  }
  if (typeof res === 'object' && res !== null && Object.keys(res).length > 0) {
    return res as Record<string, unknown>
  }
  return undefined
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  // GAP-23: PinoLogger вместо Nest Logger — структурные логи с redact.
  constructor(private readonly pinoLogger: PinoLogger) {
    this.pinoLogger.setContext(GlobalExceptionFilter.name)
  }

  catch(exception: unknown, host: ArgumentsHost): Response<any, Record<string, any>> {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request & { id?: string }>()
    const requestId = request.id

    if (exception instanceof AppError) {
      return response
        .status(exception.httpStatus)
        .json(errorResponse(exception.code, exception.message, exception.context, requestId))
    }

    if (exception instanceof HttpException) {
      return this.respondHttpException(exception, response, requestId)
    }

    // Unknown — log server-side only (no full err object: он может нести тела
    // запросов/токены из upstream-ошибок), return generic 500 to client.
    const isErr = exception instanceof Error
    this.pinoLogger.error(
      {
        requestId,
        err: {
          type: isErr ? exception.name : typeof exception,
          message: isErr ? exception.message : String(exception),
          stack: isErr ? exception.stack : undefined,
        },
      },
      'Unhandled exception',
    )
    return response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(errorResponse('INTERNAL_ERROR', 'Something went wrong', undefined, requestId))
  }

  /** Nest-ошибки: вытаскиваем message/error/validation из response-объекта. */
  private respondHttpException(
    exception: HttpException,
    response: Response,
    requestId: string | undefined,
  ): Response<any, Record<string, any>> {
    const status = exception.getStatus()
    const res = exception.getResponse()
    // NestJS validation pipe returns { message: string | string[], error, statusCode }.
    // For 4xx we surface the message in details so the client knows what to fix.
    // We do NOT pass arrays directly to errorResponse (which expects Record) — we
    // wrap them under details.validation so the JSON shape is always stable.
    const message = payloadMessage(res, exception.message)
    const code = payloadCode(res)
    return response
      .status(status)
      .json(errorResponse(code, exception.message, payloadDetails(res, message), requestId))
  }
}
