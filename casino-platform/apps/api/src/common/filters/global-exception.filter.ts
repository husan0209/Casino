import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { AppError, errorResponse } from '@casino/shared-utils'
import { Request, Response } from 'express'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request & { id?: string }>()
    const requestId = request.id

    if (exception instanceof AppError) {
      return response.status(exception.httpStatus).json(
        errorResponse(exception.code, exception.message, exception.context, requestId),
      )
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const res = exception.getResponse()
      // NestJS validation pipe returns { message: string | string[], error, statusCode }.
      // For 4xx we surface the message in details so the client knows what to fix.
      // We do NOT pass arrays directly to errorResponse (which expects Record) — we
      // wrap them under details.validation so the JSON shape is always stable.
      const message = typeof res === 'object' && res !== null && 'message' in res
        ? (res as { message: unknown }).message
        : exception.message
      const code = typeof res === 'object' && res !== null && 'error' in res
        ? String((res as { error: unknown }).error).toUpperCase().replace(/\s+/g, '_')
        : 'HTTP_ERROR'
      const details = Array.isArray(message)
        ? { validation: message }
        : typeof res === 'object' && res !== null && Object.keys(res).length > 0
          ? (res as Record<string, unknown>)
          : undefined
      return response.status(status).json(errorResponse(code, exception.message, details, requestId))
    }

    // Unknown — log full error (server side), return generic 500 to client.
    this.logger.error({ msg: 'Unhandled exception', err: exception, requestId })
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(
      errorResponse('INTERNAL_ERROR', 'Something went wrong', undefined, requestId),
    )
  }
}
