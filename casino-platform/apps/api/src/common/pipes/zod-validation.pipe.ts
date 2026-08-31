import { type ArgumentMetadata, type PipeTransform, BadRequestException } from '@nestjs/common'
import { type ZodSchema } from 'zod'

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}
  transform(value: unknown, metadata: ArgumentMetadata) {
    // Контроллер-скоуп @UsePipes применяется ко ВСЕМ параметрам хендлера
    // (в т.ч. @CurrentUser() и @Param()) — валидируем только тело запроса.
    // Без этого guard'а эндпоинты с pipe'ом всегда отдавали 400 (найдено E2E, PR #15).
    if (metadata.type !== 'body') {
      return value
    }
    try {
      return this.schema.parse(value)
    } catch (e: any) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: e.message })
    }
  }
}
