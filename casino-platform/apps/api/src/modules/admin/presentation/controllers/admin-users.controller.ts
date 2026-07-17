import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { prisma } from '@casino/database'
import { AdminAuthGuard } from '../admin-auth.guard'
import { AuditLogService } from '../../application/audit-log.service'

@UseGuards(AdminAuthGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private audit: AuditLogService) {}
  @Get()
  async list(@Query() q: any) {
    const page = parseInt(q.page)||1, perPage = Math.min(parseInt(q.per_page)||20,100)
    const where:any = {}
    if (q.status) where.status = q.status
    if (q.search) where.OR = [{ email: { contains: q.search, mode:'insensitive' }}, { username: { contains: q.search, mode:'insensitive' }}]
    const [items,total] = await Promise.all([
      prisma.user.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{createdAt:'desc'}, select:{ id:true,email:true,status:true,createdAt:true,lastLoginAt:true,referralCode:true }}),
      prisma.user.count({ where })
    ])
    return { items, meta:{ page, perPage, total, totalPages: Math.ceil(total/perPage)}}
  }
  @Get(':id')
  async get(@Param('id') id: string) {
    const user = await prisma.user.findUnique({ where:{id}, include:{ profile:true, settings:true, kycProfile:true, walletAccounts:true }})
    return user
  }
  @Post(':id/block')
  async block(@Param('id') id: string, @Body() b: { reason?: string }, @Req() req:any) {
    await prisma.user.update({ where:{id}, data:{ status:'blocked' }})
    await prisma.session.updateMany({ where:{ userId:id, revokedAt:null }, data:{ revokedAt: new Date() }})
    await this.audit.log({ actorType:'admin', actorId:req.user.id, action:'admin.user.blocked', targetType:'user', targetId:id, payload:{ reason: b.reason }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    return { ok:true }
  }
  @Post(':id/unblock')
  async unblock(@Param('id') id: string, @Req() req:any) {
    await prisma.user.update({ where:{id}, data:{ status:'active' }})
    await this.audit.log({ actorType:'admin', actorId:req.user.id, action:'admin.user.unblocked', targetType:'user', targetId:id, ipAddress:req.ip })
    return { ok:true }
  }
}
