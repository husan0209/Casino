import { Inject, Injectable } from '@nestjs/common'

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogInput,
  type IAuditLogRepository,
} from '../domain/admin.repository'

@Injectable()
export class AuditLogService {
  constructor(@Inject(AUDIT_LOG_REPOSITORY) private readonly repo: IAuditLogRepository) {}

  async log(input: AuditLogInput) {
    await this.repo.log(input)
  }
}
