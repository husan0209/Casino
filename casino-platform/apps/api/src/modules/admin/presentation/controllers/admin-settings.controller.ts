import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { prisma } from '@casino/database'
import { AdminAuthGuard } from '../admin-auth.guard'
import { AuditLogService } from '../../application/audit-log.service'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'

@UseGuards(AdminAuthGuard)
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private audit: AuditLogService) {}

  @Get()
  async getSettings() {
    return prisma.systemSetting.findMany()
  }

  @Post()
  async updateSetting(@Body() body: { key: string; value: string; type: any }, @CurrentUser() admin: any, @Req() req: any) {
    const setting = await prisma.systemSetting.upsert({
      where: { key: body.key },
      update: { value: body.value, updatedBy: admin.id },
      create: { key: body.key, value: body.value, type: body.type || 'string', updatedBy: admin.id }
    })
    await this.audit.log({ actorType:'admin', actorId: admin.id, action:'admin.settings.updated', targetType:'system_setting', targetId: body.key, payload:{ value: body.value }, ipAddress: req.ip })
    return setting
  }

  // Email template management (simulated via SystemSettings since there is no EmailTemplate model)
  @Get('email-templates')
  async getEmailTemplates() {
    return prisma.systemSetting.findMany({
      where: { key: { startsWith: 'email_template_' } }
    })
  }

  @Post('email-templates')
  async updateEmailTemplate(@Body() body: { name: string; subject: string; htmlBody: string }, @CurrentUser() admin: any, @Req() req: any) {
    const templateKey = `email_template_${body.name}`
    const templateValue = JSON.stringify({ subject: body.subject, htmlBody: body.htmlBody })
    await prisma.systemSetting.upsert({
      where: { key: templateKey },
      update: { value: templateValue, updatedBy: admin.id },
      create: { key: templateKey, value: templateValue, type: 'json' as any, updatedBy: admin.id }
    })
    await this.audit.log({ actorType:'admin', actorId: admin.id, action:'admin.email_templates.updated', targetType:'email_template', targetId: body.name, payload:{ subject: body.subject }, ipAddress: req.ip })
    return { name: body.name, subject: body.subject, htmlBody: body.htmlBody }
  }
}
