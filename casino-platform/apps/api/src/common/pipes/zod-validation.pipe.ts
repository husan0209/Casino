import { PipeTransform, ArgumentMetadata, BadRequestException } from '@nestjs/common'
import { ZodSchema } from 'zod'
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}
  transform(value: unknown) {
    try { return this.schema.parse(value) } catch(e:any){ throw new BadRequestException({ code:'VALIDATION_ERROR', message:e.message }) }
  }
}
