import { Inject, Injectable } from '@nestjs/common'

import {
  type ISystemSettingRepository,
  type SystemSettingRow,
  SYSTEM_SETTING_REPOSITORY,
} from '../domain/system.repository'

import type { SystemSettingType } from '@prisma/client'

/** Настройки и email-шаблоны (В3: контроллер — тонкий делегат). */
@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(SYSTEM_SETTING_REPOSITORY) private readonly repo: ISystemSettingRepository,
  ) {}

  list(): Promise<SystemSettingRow[]> {
    return this.repo.findMany()
  }

  listEmailTemplates(): Promise<SystemSettingRow[]> {
    return this.repo.findEmailTemplates()
  }

  upsert(input: { key: string; value: string; type: SystemSettingType; updatedBy: string }): Promise<SystemSettingRow> {
    return this.repo.upsert(input)
  }
}
