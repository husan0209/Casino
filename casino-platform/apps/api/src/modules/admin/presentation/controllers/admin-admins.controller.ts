import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { AdminAuthGuard } from '../admin-auth.guard'
import { AdminUsersService } from '../../application/admin-users.service'
import { AuditLogService } from '../../application/audit-log.service'
function isSuper(req:any){ return req.user?.role==='superadmin' }
@UseGuards(AdminAuthGuard)
@Controller('admin/admins')
export class AdminAdminsController {
  constructor(private svc: AdminUsersService, private audit: AuditLogService) {}
  @Get() async list(){ const r = await this.svc.list(1,100); return r.items }
  @Post()
  async create(@Body() body:any, @Req() req:any){
    if(!isSuper(req)) return { success:false, error:{ code:'FORBIDDEN', message:'superadmin only'}}
    const admin = await this.svc.create(body, req.user.id)
    await this.audit.log({ actorType:'admin', actorId:req.user.id, action:'admin.admin_created', targetType:'admin_user', targetId: admin.id })
    return admin
  }
  @Post(':id/deactivate')
  async deactivate(@Param('id') id:string, @Req() req:any){
    if(!isSuper(req)) return { success:false, error:{ code:'FORBIDDEN', message:'superadmin only'}}
    await this.svc.block(id)
    await this.audit.log({ actorType:'admin', actorId:req.user.id, action:'admin.admin_deactivated', targetId:id })
    return { ok:true }
  }
}
