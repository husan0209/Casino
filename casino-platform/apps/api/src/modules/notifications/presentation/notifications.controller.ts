import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../auth/presentation/guards/auth.guard'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { NotificationService } from '../application/notification.service'

@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private svc: NotificationService) {}
  @Get()
  async list(@CurrentUser() u:any, @Query() q:any){
    const page=parseInt(q.page)||1, perPage=parseInt(q.per_page)||20
    const isRead = q.is_read === undefined ? undefined : q.is_read === 'true'
    const r = await this.svc.list(u.id, page, perPage, isRead)
    return { data: r.items, meta: { page, perPage, total: r.total, unread: r.unreadCount }}
  }
  @Get('unread-count')
  unread(@CurrentUser() u:any){ return this.svc.unreadCount(u.id) }
  @Post(':id/read')
  read(@CurrentUser() u:any, @Param('id') id:string){ return this.svc.markRead(u.id, id) }
  @Post('read-all')
  readAll(@CurrentUser() u:any){ return this.svc.markAllRead(u.id) }
}
