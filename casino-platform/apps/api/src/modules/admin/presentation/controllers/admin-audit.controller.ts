import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { prisma } from '@casino/database'
import { AdminAuthGuard } from '../admin-auth.guard'
@UseGuards(AdminAuthGuard)
@Controller('admin/audit-logs')
export class AdminAuditController {
  @Get()
  async list(@Query() q:any){
    const page=parseInt(q.page)||1, perPage=Math.min(parseInt(q.per_page)||50,200)
    const where:any={}
    if(q.actor_type) where.actorType=q.actor_type
    if(q.actor_id) where.actorId=q.actor_id
    if(q.action) where.action={ contains:q.action }
    if(q.target_type) where.targetType=q.target_type
    const [items,total]=await Promise.all([
      prisma.auditLog.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{createdAt:'desc'}}),
      prisma.auditLog.count({where})
    ])
    return { items, meta:{ page, perPage, total }}
  }
}
