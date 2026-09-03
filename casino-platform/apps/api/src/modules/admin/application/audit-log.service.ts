import { Inject, Injectable } from '@nestjs/common'

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogInput,
  IAuditLogRepository,
} from '../domain/admin.repository'

@Injectable()
export class AuditLogService {
  constructor(@Inject(AUDIT_LOG_REPOSITORY) private readonly repo: IAuditLogRepository) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.repo.log(input)
  }
}
