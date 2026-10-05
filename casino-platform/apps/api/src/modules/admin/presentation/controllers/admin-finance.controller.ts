import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { type Request } from 'express'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AdminActor } from '@/common/types/req-user'

import {
  PaymentsFacade,
  type PaymentRequestAdminRow,
  type PaymentRequestDetailRow,
} from '@modules/payments/facade/payments.facade'
import { type LedgerEntryAdminRow, WalletFacade } from '@modules/wallet/facade/wallet.facade'

import { type LedgerEntry, PaymentType } from '@casino/database'
import { type CreditResult, type Currency } from '@casino/shared-types'
import { AppError } from '@casino/shared-utils'

import { AuditLogService } from '../../application/audit-log.service'
import { approveWithdrawal } from '../../application/use-cases/approve-withdrawal.use-case'
import { rejectWithdrawal } from '../../application/use-cases/reject-withdrawal.use-case'
import {
  type WithdrawalDecisionContext,
  type WithdrawalDecisionDependencies,
} from '../../application/withdrawal-decision-deps'
import { AdminForbiddenError } from '../../domain/errors'
import {
  type IWithdrawalRequestStore,
  WITHDRAWAL_REQUEST_STORE,
} from '../../domain/withdrawal.repository'
import { AdminAuthGuard } from '../admin-auth.guard'
import {
  AdminPaymentRequestsQuerySchema,
  AdminTransactionsQuerySchema,
  AdminWithdrawalsQuerySchema,
  BatchApproveSchema,
  BatchRejectSchema,
  RejectWithdrawalSchema,
  WalletAdjustSchema,
  type AdminPaymentRequestsQueryDto,
  type AdminTransactionsQueryDto,
  type AdminWithdrawalsQueryDto,
} from '../dto/admin-finance.dto'

/**
 * UC-PAY-18: карточка платёжной заявки для админки. Строки приходят типами,
 * ВЫВЕДЕННЫМИ из include-конфигурации запроса владельца таблицы (payments,
 * wallet) — развёрнутые вручную литералы уже расходились с колонками.
 */
type PaymentRequestDetailView = {
  payment_request: PaymentRequestDetailRow | null
  callbacks: PaymentRequestDetailRow['callbacks'] | undefined
  ledger_entries: LedgerEntry[]
}

@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminFinanceController {
  constructor(
    @Inject(WalletFacade) private wallet: WalletFacade,
    @Inject(WITHDRAWAL_REQUEST_STORE) private payments: IWithdrawalRequestStore,
    @Inject(AuditLogService) private audit: AuditLogService,
    // Чтение заявок отдаёт payments (гард G27): `payment_requests` — его таблица.
    // Имя поля с суффиксом Facade, а не `payments`: `payments` уже занято узким
    // портом решений по заявке, а `paymentRequests` столкнулось бы с методом
    // контроллера с тем же именем.
    @Inject(PaymentsFacade) private paymentsFacade: PaymentsFacade,
  ) {}

  // UC-PAY-16 transactions
  @Get('transactions')
  @UsePipes(new ZodValidationPipe(AdminTransactionsQuerySchema))
  async transactions(@Query() q: AdminTransactionsQueryDto): Promise<{
    items: LedgerEntryAdminRow[]
    meta: { page: number; perPage: number; total: number }
  }> {
    const { items, total } = await this.wallet.listLedgerEntries({
      userId: q.user_id,
      type: q.type,
      currency: q.currency,
      page: q.page,
      perPage: q.per_page,
    })
    return { items, meta: { page: q.page, perPage: q.per_page, total } }
  }

  // UC-PAY-17 payment_requests
  @Get('payment-requests')
  @UsePipes(new ZodValidationPipe(AdminPaymentRequestsQuerySchema))
  async paymentRequests(@Query() q: AdminPaymentRequestsQueryDto): Promise<{
    items: PaymentRequestAdminRow[]
    meta: { page: number; perPage: number; total: number }
  }> {
    const { items, total } = await this.paymentsFacade.listPaymentRequests({
      userId: q.user_id,
      type: q.type,
      status: q.status,
      provider: q.provider,
      page: q.page,
      perPage: q.per_page,
    })
    return { items, meta: { page: q.page, perPage: q.per_page, total } }
  }

  // UC-PAY-18 details
  @Get('payment-requests/:id')
  async paymentDetail(@Param('id') id: string): Promise<PaymentRequestDetailView> {
    const pr = await this.paymentsFacade.getPaymentRequestDetail(id)
    // Проводки — справочный блок карточки: не дождавшись их, страница заявки
    // всё равно показывает главное, поэтому сбой этого чтения не должен
    // превращать карточку в 500.
    const ledger = await this.wallet.listEntriesForPaymentRequest(id).catch(() => [])
    return { payment_request: pr, callbacks: pr?.callbacks, ledger_entries: ledger }
  }

  // UC-PAY-10 withdrawals list
  @Get('withdrawals')
  @UsePipes(new ZodValidationPipe(AdminWithdrawalsQuerySchema))
  async withdrawals(@Query() q: AdminWithdrawalsQueryDto): Promise<{
    items: PaymentRequestAdminRow[]
    meta: { page: number; perPage: number; total: number }
  }> {
    // Тип фиксируется здесь, а не берётся из query: /withdrawals — это
    // payment_requests с фильтром type=withdrawal, и подменить его запросом нельзя.
    const { items, total } = await this.paymentsFacade.listPaymentRequests({
      type: PaymentType.withdrawal,
      userId: q.user_id,
      status: q.status,
      currency: q.currency,
      page: q.page,
      perPage: q.per_page,
    })
    return { items, meta: { page: q.page, perPage: q.per_page, total } }
  }

  /**
   * Порты для сценариев решения по заявке (В3).
   *
   * Контроллер не выполняет ни одной записи в БД: `payments.updateStatus`
   * вызывает application use case, а сюда за зависимостями приходит узкий порт
   * `WITHDRAWAL_REQUEST_STORE` (реализация — адаптер над `PaymentsFacade`), а не
   * репозиторий чужого модуля.
   */
  private withdrawalDependencies(): WithdrawalDecisionDependencies {
    return { payments: this.payments, wallet: this.wallet, audit: this.audit }
  }

  /** HTTP-контекст решения: кто и откуда нажал «одобрить»/«отклонить». */
  private decisionContext(admin: AdminActor, req: Request): WithdrawalDecisionContext {
    return { actorId: admin.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] }
  }

  /** Код ошибки для частичного успеха batch-операции (стабильный AppError.code). */
  private failureCode(error: unknown): string {
    if (error instanceof AppError) {
      return error.code
    }
    return error instanceof Error ? error.message : String(error)
  }

  // UC-PAY-11 approve
  @Post('withdrawals/:id/approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{ ok: boolean }> {
    await approveWithdrawal(this.withdrawalDependencies(), {
      paymentRequestId: id,
      context: this.decisionContext(admin, req),
    })
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
  ): Promise<{ ok: boolean }> {
    await rejectWithdrawal(this.withdrawalDependencies(), {
      paymentRequestId: id,
      reason: body.reason,
      context: this.decisionContext(admin, req),
    })
    return { ok: true }
  }

  // UC-ADMIN-FIN-05 batch approve – каждая заявка обрабатывается независимо (TZ part 6 §6.3)
  @Post('withdrawals/batch-approve')
  @UsePipes(new ZodValidationPipe(BatchApproveSchema))
  async batchApprove(
    @Body() body: { ids: string[] },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{ ok: boolean; approved: number; failed: { id: string; error: string }[] }> {
    const failed: Array<{ id: string; error: string }> = []
    let approved = 0
    for (const id of body.ids) {
      try {
        await approveWithdrawal(this.withdrawalDependencies(), {
          paymentRequestId: id,
          context: this.decisionContext(admin, req),
        })
        approved++
      } catch (error) {
        failed.push({ id, error: this.failureCode(error) })
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
  ): Promise<{ ok: boolean; rejected: number; failed: { id: string; error: string }[] }> {
    const failed: Array<{ id: string; error: string }> = []
    let rejected = 0
    for (const id of body.ids) {
      try {
        await rejectWithdrawal(this.withdrawalDependencies(), {
          paymentRequestId: id,
          reason: body.reason,
          context: this.decisionContext(admin, req),
        })
        rejected++
      } catch (error) {
        failed.push({ id, error: this.failureCode(error) })
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
      throw new AdminForbiddenError()
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
      throw new AdminForbiddenError()
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
