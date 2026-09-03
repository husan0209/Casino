import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes } from '@nestjs/common'
import { type Request } from 'express'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AdminActor } from '@/common/types/req-user'
import { type KycDocumentType, type KycStatus, prisma, type Prisma, type UserRole, type UserStatus } from '@casino/database'

import { type AuditLogService } from '../../application/audit-log.service'
import { AdminAuthGuard } from '../admin-auth.guard'
import { BlockUserSchema } from '../dto/admin-users.dto'

@UseGuards(AdminAuthGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  async list(
    @Query() queryParams: { page?: string; per_page?: string; status?: string; search?: string },
  ): Promise<{ items: { id: string; email: string | null; lastLoginAt: Date | null; createdAt: Date; status: UserStatus; referralCode: string; }[]; meta: { page: number; perPage: number; total: number; totalPages: number; }; }> {
    const page = parseInt(queryParams.page || '1', 10) || 1
    const perPage = Math.min(parseInt(queryParams.per_page || '20', 10) || 20, 100)

    const where: Prisma.UserWhereInput = {}
    if (queryParams.status) {
      where.status = queryParams.status as UserStatus
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
  async get(@Param('id') userId: string): Promise<({ kycProfile: { id: string; firstName: string | null; lastName: string | null; createdAt: Date; updatedAt: Date; userId: string; status: KycStatus; dateOfBirth: Date | null; country: string | null; documentType: KycDocumentType | null; documentNumber: string | null; documentExpiry: Date | null; rejectionReason: string | null; approvedAt: Date | null; rejectedAt: Date | null; submittedAt: Date | null; reviewedBy: string | null; } | null; profile: { id: string; firstName: string | null; lastName: string | null; createdAt: Date; updatedAt: Date; userId: string; dateOfBirth: Date | null; country: string | null; phone: string | null; phoneVerified: boolean; city: string | null; avatarUrl: string | null; currencyPreference: string; lastPaymentMethod: string | null; } | null; settings: { id: string; createdAt: Date; updatedAt: Date; userId: string; notificationsEmail: boolean; notificationsPush: boolean; twoFaEnabled: boolean; twoFaSecret: string | null; language: string; timezone: string; selfExcludedUntil: Date | null; } | null; walletAccounts: { id: string; createdAt: Date; updatedAt: Date; userId: string; currency: string; balance: Prisma.Decimal; locked: Prisma.Decimal; version: bigint; }[]; } & { id: string; email: string | null; passwordHash: string | null; role: UserRole; lastLoginAt: Date | null; createdAt: Date; updatedAt: Date; emailVerified: boolean; username: string | null; status: UserStatus; referralCode: string; referredBy: string | null; failedLoginAttempts: number; lastFailedAt: Date | null; lockedUntil: Date | null; }) | null> {
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
  async block(@Param('id') userId: string, @Body() dto: { reason?: string }, @Req() req: Request): Promise<{ ok: boolean; }> {
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
      actorId: (req.user as AdminActor).id,
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
  async unblock(@Param('id') userId: string, @Req() req: Request): Promise<{ ok: boolean; }> {
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'active' },
    })
    await this.auditLogService.log({
      actorType: 'admin',
      actorId: (req.user as AdminActor).id,
      action: 'admin.user.unblocked',
      targetType: 'user',
      targetId: userId,
      ipAddress: req.ip,
    })
    return { ok: true }
  }
}
