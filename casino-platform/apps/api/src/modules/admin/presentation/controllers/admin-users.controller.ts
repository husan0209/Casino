import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes } from '@nestjs/common'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { prisma } from '@casino/database'

import { AuditLogService } from '../../application/audit-log.service'
import { AdminAuthGuard } from '../admin-auth.guard'
import { BlockUserSchema } from '../dto/admin-users.dto'

@UseGuards(AdminAuthGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  async list(
    @Query() queryParams: { page?: string; per_page?: string; status?: string; search?: string },
  ) {
    const page = parseInt(queryParams.page || '1', 10) || 1
    const perPage = Math.min(parseInt(queryParams.per_page || '20', 10) || 20, 100)

    const where: any = {}
    if (queryParams.status) {
      where.status = queryParams.status
    }
    if (queryParams.search) {
      where.OR = [
        { email: { contains: queryParams.search, mode: 'insensitive' } },
        { username: { contains: queryParams.search, mode: 'insensitive' } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          referralCode: true,
        },
      }),
      prisma.user.count({ where }),
    ])

    return {
      items,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    }
  }

  @Get(':id')
  async get(@Param('id') userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        settings: true,
        kycProfile: true,
        walletAccounts: true,
      },
    })
    return user
  }

  @Post(':id/block')
  @UsePipes(new ZodValidationPipe(BlockUserSchema))
  async block(@Param('id') userId: string, @Body() dto: { reason?: string }, @Req() req: any) {
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'blocked' },
    })
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await this.auditLogService.log({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'admin.user.blocked',
      targetType: 'user',
      targetId: userId,
      payload: { reason: dto.reason },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    return { ok: true }
  }

  @Post(':id/unblock')
  async unblock(@Param('id') userId: string, @Req() req: any) {
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'active' },
    })
    await this.auditLogService.log({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'admin.user.unblocked',
      targetType: 'user',
      targetId: userId,
      ipAddress: req.ip,
    })
    return { ok: true }
  }
}
