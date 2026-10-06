import { type ArgumentMetadata, type PipeTransform, BadRequestException } from '@nestjs/common'
import { type ZodType } from 'zod'

import { errorMessage } from '@/common/utils/error-message'


export class ZodValidationPipe implements PipeTransform {
  constructor(
    private schema: ZodType,
    /**
     * Какие типы параметров валидировать. По умолчанию — только `body`: pipe
     * вешается скоупом на метод/контроллер и применяется ко ВСЕМ параметрам
     * хендлера (в т.ч. @CurrentUser() и @Param()), иначе схема тела валидировала
     * бы их (найдено E2E, PR #15).
     *
     * Для GET-эндпоинтов, где схема относится к строке запроса, типы передаются
     * явно при точечном применении: @Query(new ZodValidationPipe(Schema, ['query'])).
     * Без этого @UsePipes(new ZodValidationPipe(<query-схема>)) не валидировал
     * ровным счётом ничего — ClickQuerySchema/CommissionListQuerySchema/
     * AffiliateListQuerySchema существовали только как текст.
     */
    private types: readonly string[] = ['body'],
  ) {}
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!this.types.includes(metadata.type)) {
      return value
    }
    try {
      return this.schema.parse(value)
    } catch (e) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: errorMessage(e) })
    }
  }
}
