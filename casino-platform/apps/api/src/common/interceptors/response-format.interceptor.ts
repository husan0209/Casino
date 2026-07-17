import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable, map } from 'rxjs'
import { successResponse } from '@casino/shared-utils'
@Injectable()
export class ResponseFormatInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map(data => {
      if (data && typeof data === 'object' && 'success' in data) return data
      return successResponse(data)
    }))
  }
}
