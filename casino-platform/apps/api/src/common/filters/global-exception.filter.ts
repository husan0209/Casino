import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import { AppError } from '@casino/shared-utils'
import { errorResponse } from '@casino/shared-utils'
import { Request, Response } from 'express'
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request & { id?: string }>()
    const requestId = request.id
    if (exception instanceof AppError) {
      return response.status(exception.httpStatus).json(errorResponse(exception.code, exception.message, exception.context, requestId))
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const res: any = exception.getResponse()
      return response.status(status).json(errorResponse(res.error || 'HTTP_ERROR', res.message || exception.message, undefined, requestId))
    }
    console.error('Unhandled', exception)
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(errorResponse('INTERNAL_ERROR','Something went wrong', undefined, requestId))
  }
}
