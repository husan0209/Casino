import { Body, Controller, Get, Inject, Post, Req, UseGuards, UsePipes } from '@nestjs/common'
import { type Request } from 'express'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AdminActor } from '@/common/types/req-user'

import type { SystemSettingType } from '@casino/database'

import { AdminSettingsService } from '../../application/admin-settings.service'
import { AuditLogService } from '../../application/audit-log.service'
import { AdminAuthGuard } from '../admin-auth.guard'
import { EmailTemplateSchema, UpsertSettingSchema } from '../dto/admin-settings.dto'

@UseGuards(AdminAuthGuard)
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    @Inject(AdminSettingsService) private settings: AdminSettingsService,
    @Inject(AuditLogService) private audit: AuditLogService,
  ) {}

  @Get()
  getSettings(): Promise<
    {
      id: string
      updatedAt: Date
      type: SystemSettingType
      description: string | null
      key: string
      value: string
      category: string | null
      updatedBy: string | null
    }[]
  > {
    return this.settings.list()
  }

  @Post()
  @UsePipes(new ZodValidationPipe(UpsertSettingSchema))
  async updateSetting(
    @Body() body: { key: string; value: string; type: string },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{
    id: string
    updatedAt: Date
    type: SystemSettingType
    description: string | null
    key: string
    value: string
    category: string | null
    updatedBy: string | null
  }> {
    const setting = await this.settings.upsert({
      key: body.key,
      value: body.value,
      type: (body.type || 'string') as SystemSettingType,
      updatedBy: admin.id,
    })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.settings.updated',
      targetType: 'system_setting',
      targetId: body.key,
      payload: { value: body.value },
      ipAddress: req.ip,
    })
    return setting
  }

  // Email template management (simulated via SystemSettings since there is no EmailTemplate model)
  @Get('email-templates')
  getEmailTemplates(): Promise<
    {
      id: string
      updatedAt: Date
      type: SystemSettingType
      description: string | null
      key: string
      value: string
      category: string | null
      updatedBy: string | null
    }[]
  > {
    return this.settings.listEmailTemplates()
  }

  @Post('email-templates')
  @UsePipes(new ZodValidationPipe(EmailTemplateSchema))
  async updateEmailTemplate(
    @Body() body: { name: string; subject: string; htmlBody: string },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{ name: string; subject: string; htmlBody: string }> {
    const templateKey = `email_template_${body.name}`
    const templateValue = JSON.stringify({ subject: body.subject, htmlBody: body.htmlBody })
    await this.settings.upsert({
      key: templateKey,
      value: templateValue,
      type: 'json' as SystemSettingType,
      updatedBy: admin.id,
    })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.email_templates.updated',
      targetType: 'email_template',
      targetId: body.name,
      payload: { subject: body.subject },
      ipAddress: req.ip,
    })
    return { name: body.name, subject: body.subject, htmlBody: body.htmlBody }
  }
}
