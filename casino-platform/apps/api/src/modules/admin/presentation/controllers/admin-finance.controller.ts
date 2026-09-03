import { randomUUID } from 'crypto'
import { CreditResult } from '@modules/wallet/domain/repositories/wallet.repository'

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes } from '@nestjs/common'
import { type Request } from 'express'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AdminActor } from '@/common/types/req-user'

import { PaymentRequestRepository } from '@modules/payments/infrastructure/repositories/payment-request.repository'
import { WalletFacade } from '@modules/wallet/application/wallet.facade'

import {
  prisma,
  type LedgerEntryType,
  type PaymentProvider,
  type PaymentStatus,
  type PaymentType,
  type Prisma,
} from '@casino/database'
import { type Currency } from '@casino/shared-types'
import { AppError } from '@casino/shared-utils'

import { AuditLogService } from '../../application/audit-log.service'
import { AdminAuthGuard } from '../admin-auth.guard'
import {
  BatchApproveSchema,
  BatchRejectSchema,
  RejectWithdrawalSchema,
  WalletAdjustSchema,
} from '../dto/admin-finance.dto'

export class WithdrawalInvalidStatusError extends AppError {
  readonly code = 'WITHDRAWAL_INVALID_STATUS'
  readonly httpStatus = 409
  constructor() {
    super('Заявка не найдена или уже обработана')
  }
}

/** Пагинация, общая для списков админки (q.page/q.per_page + дефолты/кап). */
function parsePagination(q: Record<string, string | undefined>): { page: number; perPage: number } {
  const page = parseInt(q.page ?? '') || 1
  const perPage = Math.min(parseInt(q.per_page ?? '') || 50, 200)
  return { page, perPage }
}

@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminFinanceController {
  constructor(
    private wallet: WalletFacade,
    private payments: PaymentRequestRepository,
    private audit: AuditLogService,
  ) {}

  // UC-PAY-16 transactions
  @Get('transactions')
  async transactions(@Query() q: Record<string, string | undefined>): Promise<{ items: ({ user: { email: string | null; } | null; walletAccount: { currency: string; }; } & { id: string; createdAt: Date; transactionId: string; walletAccountId: string; type: LedgerEntryType; amount: Prisma.Decimal; balanceBefore: Prisma.Decimal; balanceAfter: Prisma.Decimal; idempotencyKey: string | null; description: string | null; metadata: Prisma.JsonValue; userId: string | null; })[]; meta: { page: number; perPage: number; total: number; }; }> {
    const { page, perPage } = parsePagination(q)
    const where: Prisma.LedgerEntryWhereInput = {}
    if (q.user_id) {
      where.userId = q.user_id
    }
    if (q.type) {
      where.type = q.type as LedgerEntryType
    }
    if (q.currency) {
      where.walletAccount = { currency: q.currency }
    }
    const [items, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          walletAccount: { select: { currency: true } },
          user: { select: { email: true } },
        },
      }),
      prisma.ledgerEntry.count({ where }),
    ])
    return { items, meta: { page, perPage, total } }
  }

  // UC-PAY-17 payment_requests
  @Get('payment-requests')
  async paymentRequests(@Query() q: Record<string, string | undefined>): Promise<{ items: ({ user: { email: string | null; }; } & { id: string; createdAt: Date; updatedAt: Date; type: PaymentType; amount: Prisma.Decimal; idempotencyKey: string; metadata: Prisma.JsonValue; userId: string; currency: string; status: PaymentStatus; provider: PaymentProvider; method: string | null; amountRub: Prisma.Decimal | null; fee: Prisma.Decimal; externalId: string | null; externalStatus: string | null; paymentUrl: string | null; destination: Prisma.JsonValue; errorMessage: string | null; expiresAt: Date | null; completedAt: Date | null; })[]; meta: { page: number; perPage: number; total: number; }; }> {
    const { page, perPage } = parsePagination(q)
    const where: Prisma.PaymentRequestWhereInput = {}
    if (q.user_id) {
      where.userId = q.user_id
    }
    if (q.type) {
      where.type = q.type as PaymentType
    }
    if (q.status) {
      where.status = q.status as PaymentStatus
    }
    if (q.provider) {
      where.provider = q.provider as PaymentProvider
    }
    const [items, total] = await Promise.all([
      prisma.paymentRequest.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } },
      }),
      prisma.paymentRequest.count({ where }),
    ])
    return { items, meta: { page, perPage, total } }
  }

  // UC-PAY-18 details
  @Get('payment-requests/:id')
  async paymentDetail(@Param('id') id: string): Promise<{ payment_request: ({ user: { email: string | null; }; callbacks: { id: string; createdAt: Date; ipAddress: string | null; provider: string; externalId: string | null; paymentRequestId: string | null; rawHeaders: Prisma.JsonValue; rawBody: string | null; processed: boolean; processingResult: string | null; }[]; } & { id: string; createdAt: Date; updatedAt: Date; type: PaymentType; amount: Prisma.Decimal; idempotencyKey: string; metadata: Prisma.JsonValue; userId: string; currency: string; status: PaymentStatus; provider: PaymentProvider; method: string | null; amountRub: Prisma.Decimal | null; fee: Prisma.Decimal; externalId: string | null; externalStatus: string | null; paymentUrl: string | null; destination: Prisma.JsonValue; errorMessage: string | null; expiresAt: Date | null; completedAt: Date | null; }) | null; callbacks: { id: string; createdAt: Date; ipAddress: string | null; provider: string; externalId: string | null; paymentRequestId: string | null; rawHeaders: Prisma.JsonValue; rawBody: string | null; processed: boolean; processingResult: string | null; }[] | undefined; ledger_entries: { id: string; createdAt: Date; transactionId: string; walletAccountId: string; type: LedgerEntryType; amount: Prisma.Decimal; balanceBefore: Prisma.Decimal; balanceAfter: Prisma.Decimal; idempotencyKey: string | null; description: string | null; metadata: Prisma.JsonValue; userId: string | null; }[] | never[]; }> {
    const pr = await prisma.paymentRequest.findUnique({
      where: { id },
      include: { callbacks: true, user: { select: { email: true } } },
    })
    const ledger = await prisma.ledgerEntry
      .findMany({ where: { metadata: { path: ['payment_request_id'], equals: id } } })
      .catch(() => [])
    return { payment_request: pr, callbacks: pr?.callbacks, ledger_entries: ledger }
  }

  // UC-PAY-10 withdrawals list
  @Get('withdrawals')
  async withdrawals(@Query() q: Record<string, string | undefined>): Promise<{ items: ({ user: { email: string | null; }; } & { id: string; createdAt: Date; updatedAt: Date; type: PaymentType; amount: Prisma.Decimal; idempotencyKey: string; metadata: Prisma.JsonValue; userId: string; currency: string; status: PaymentStatus; provider: PaymentProvider; method: string | null; amountRub: Prisma.Decimal | null; fee: Prisma.Decimal; externalId: string | null; externalStatus: string | null; paymentUrl: string | null; destination: Prisma.JsonValue; errorMessage: string | null; expiresAt: Date | null; completedAt: Date | null; })[]; meta: { page: number; perPage: number; total: number; }; }> {
    const { page, perPage } = parsePagination(q)
    const where: Prisma.PaymentRequestWhereInput = { type: 'withdrawal' }
    if (q.status) {
      where.status = q.status as PaymentStatus
    }
    if (q.user_id) {
      where.userId = q.user_id
    }
    if (q.currency) {
      where.currency = q.currency
    }
    const [items, total] = await Promise.all([
      prisma.paymentRequest.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } },
      }),
      prisma.paymentRequest.count({ where }),
    ])
    return { items, meta: { page, perPage, total } }
  }

  /** Общая логика одобрения одной заявки (single + batch). */
  private async approveOne(id: string, admin: AdminActor, req: Request): Promise<void> {
    const wd = await this.payments.findById(id)
    if (!wd || wd.type !== 'withdrawal' || wd.status !== 'pending') {
      throw new WithdrawalInvalidStatusError()
    }
    await this.wallet.confirmWithdrawal({
      userId: wd.userId,
      currency: wd.currency as Currency,
      amount: wd.amount.toString(),
      idempotencyKey: `wd_confirm_${wd.id}`,
    })
    await this.payments.updateStatus(id, 'completed', { completedAt: new Date() })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.withdrawal.approved',
      targetType: 'payment_request',
      targetId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  /** Общая логика отклонения одной заявки (single + batch). */
  private async rejectOne(id: string, reason: string | undefined, admin: AdminActor, req: Request): Promise<void> {
    const wd = await this.payments.findById(id)
    if (!wd || wd.type !== 'withdrawal' || wd.status !== 'pending') {
      throw new WithdrawalInvalidStatusError()
    }
    await this.wallet.unlock({
      userId: wd.userId,
      currency: wd.currency as Currency,
      amount: wd.amount.toString(),
      idempotencyKey: `wd_unlock_${wd.id}_${randomUUID()}`,
    })
    await this.payments.updateStatus(id, 'cancelled', { errorMessage: reason })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.withdrawal.rejected',
      targetType: 'payment_request',
      targetId: id,
      payload: { reason },
      ipAddress: req.ip,
    })
  }

  // UC-PAY-11 approve
  @Post('withdrawals/:id/approve')
  async approve(@Param('id') id: string, @CurrentUser() admin: AdminActor, @Req() req: Request): Promise<{ ok: boolean; }> {
    await this.approveOne(id, admin, req)
    return { ok: true }
  }

  // UC-PAY-12 reject
  @Post('withdrawals/:id/reject')
  @UsePipes(new ZodValidationPipe(RejectWithdrawalSchema))
  async reject(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{ ok: boolean; }> {
    await this.rejectOne(id, body.reason, admin, req)
    return { ok: true }
  }

  // UC-ADMIN-FIN-05 batch approve – каждая заявка обрабатывается независимо (TZ part 6 §6.3)
  @Post('withdrawals/batch-approve')
  @UsePipes(new ZodValidationPipe(BatchApproveSchema))
  async batchApprove(
    @Body() body: { ids: string[] },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{ ok: boolean; approved: number; failed: { id: string; error: string; }[]; }> {
    const failed: Array<{ id: string; error: string }> = []
    let approved = 0
    for (const id of body.ids) {
      try {
        await this.approveOne(id, admin, req)
        approved++
      } catch (e) {
        failed.push({ id, error: e instanceof AppError ? e.code : e instanceof Error ? e.message : String(e) })
      }
    }
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.withdrawal.batch_approved',
      targetType: 'payment_request',
      payload: { requested: body.ids.length, approved, failed: failed.length },
      ipAddress: req.ip,
    })
    return { ok: true, approved, failed }
  }

  // UC-ADMIN-FIN-05 batch reject – общая причина, независимая обработка
  @Post('withdrawals/batch-reject')
  @UsePipes(new ZodValidationPipe(BatchRejectSchema))
  async batchReject(
    @Body() body: { ids: string[]; reason: string },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{ ok: boolean; rejected: number; failed: { id: string; error: string; }[]; }> {
    const failed: Array<{ id: string; error: string }> = []
    let rejected = 0
    for (const id of body.ids) {
      try {
        await this.rejectOne(id, body.reason, admin, req)
        rejected++
      } catch (e) {
        failed.push({ id, error: e instanceof AppError ? e.code : e instanceof Error ? e.message : String(e) })
      }
    }
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.withdrawal.batch_rejected',
      targetType: 'payment_request',
      payload: {
        requested: body.ids.length,
        rejected,
        failed: failed.length,
        reason: body.reason,
      },
      ipAddress: req.ip,
    })
    return { ok: true, rejected, failed }
  }

  // UC-PAY-14 credit
  @Post('wallet/:user_id/credit')
  @UsePipes(new ZodValidationPipe(WalletAdjustSchema))
  async adminCredit(
    @Param('user_id') userId: string,
    @Body() b: { amount: string; currency: string; reason: string },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<CreditResult> {
    if (admin.role !== 'superadmin') {
      throw new Error('FORBIDDEN')
    }
    const res = await this.wallet.credit({
      userId,
      currency: b.currency as Currency,
      amount: b.amount,
      type: 'ADMIN_CREDIT',
      idempotencyKey: `adm_credit_${admin.id}_${Date.now()}`,
      description: b.reason,
      metadata: { admin_id: admin.id },
    })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.balance.adjusted',
      targetType: 'user',
      targetId: userId,
      payload: { direction: 'credit', amount: b.amount, currency: b.currency, reason: b.reason },
      ipAddress: req.ip,
    })
    return res
  }

  // UC-PAY-15 debit
  @Post('wallet/:user_id/debit')
  @UsePipes(new ZodValidationPipe(WalletAdjustSchema))
  async adminDebit(
    @Param('user_id') userId: string,
    @Body() b: { amount: string; currency: string; reason: string },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<CreditResult> {
    if (admin.role !== 'superadmin') {
      throw new Error('FORBIDDEN')
    }
    const res = await this.wallet.debit({
      userId,
      currency: b.currency as Currency,
      amount: b.amount,
      type: 'ADMIN_DEBIT',
      idempotencyKey: `adm_debit_${admin.id}_${Date.now()}`,
      description: b.reason,
      metadata: { admin_id: admin.id },
    })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.balance.adjusted',
      targetType: 'user',
      targetId: userId,
      payload: { direction: 'debit', amount: b.amount, currency: b.currency, reason: b.reason },
      ipAddress: req.ip,
    })
    return res
  }
}
