import { Body, Controller, Get, Post, Req, UseGuards, UsePipes } from '@nestjs/common'
import { type Request } from 'express'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AdminActor } from '@/common/types/req-user'

import { prisma, type SystemSettingType } from '@casino/database'

import { AuditLogService } from '../../application/audit-log.service'
import { AdminAuthGuard } from '../admin-auth.guard'
import { EmailTemplateSchema, UpsertSettingSchema } from '../dto/admin-settings.dto'

@UseGuards(AdminAuthGuard)
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private audit: AuditLogService) {}

  @Get()
  async getSettings(): Promise<{ id: string; updatedAt: Date; type: SystemSettingType; description: string | null; key: string; value: string; category: string | null; updatedBy: string | null; }[]> {
    return prisma.systemSetting.findMany()
  }

  @Post()
  @UsePipes(new ZodValidationPipe(UpsertSettingSchema))
  async updateSetting(
    @Body() body: { key: string; value: string; type: string },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{ id: string; updatedAt: Date; type: SystemSettingType; description: string | null; key: string; value: string; category: string | null; updatedBy: string | null; }> {
    const setting = await prisma.systemSetting.upsert({
      where: { key: body.key },
      update: { value: body.value, updatedBy: admin.id },
      create: {
        key: body.key,
        value: body.value,
        type: (body.type || 'string') as SystemSettingType,
        updatedBy: admin.id,
      },
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
  async getEmailTemplates(): Promise<{ id: string; updatedAt: Date; type: SystemSettingType; description: string | null; key: string; value: string; category: string | null; updatedBy: string | null; }[]> {
    return prisma.systemSetting.findMany({
      where: { key: { startsWith: 'email_template_' } },
    })
  }

  @Post('email-templates')
  @UsePipes(new ZodValidationPipe(EmailTemplateSchema))
  async updateEmailTemplate(
    @Body() body: { name: string; subject: string; htmlBody: string },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{ name: string; subject: string; htmlBody: string; }> {
    const templateKey = `email_template_${body.name}`
    const templateValue = JSON.stringify({ subject: body.subject, htmlBody: body.htmlBody })
    await prisma.systemSetting.upsert({
      where: { key: templateKey },
      update: { value: templateValue, updatedBy: admin.id },
      create: { key: templateKey, value: templateValue, type: 'json' as SystemSettingType, updatedBy: admin.id },
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
