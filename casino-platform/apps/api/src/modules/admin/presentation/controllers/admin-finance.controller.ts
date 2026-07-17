import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { prisma } from '@casino/database'
import { AdminAuthGuard } from '../admin-auth.guard'
import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { PaymentRequestRepository } from '../../../payments/infrastructure/repositories/payment-request.repository'
import { AuditLogService } from '../../application/audit-log.service'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { randomUUID } from 'crypto'

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
  async transactions(@Query() q:any){
    const page=parseInt(q.page)||1, perPage=Math.min(parseInt(q.per_page)||50,200)
    const where:any = {}
    if(q.user_id) where.userId = q.user_id
    if(q.type) where.type = q.type
    if(q.currency) where.walletAccount = { currency: q.currency }
    const [items,total] = await Promise.all([
      prisma.ledgerEntry.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{createdAt:'desc'}, include:{ walletAccount:{ select:{ currency:true }}, user:{ select:{ email:true }}} }),
      prisma.ledgerEntry.count({ where })
    ])
    return { items, meta:{ page, perPage, total }}
  }

  // UC-PAY-17 payment_requests
  @Get('payment-requests')
  async paymentRequests(@Query() q:any){
    const page=parseInt(q.page)||1, perPage=Math.min(parseInt(q.per_page)||50,200)
    const where:any = {}
    if(q.user_id) where.userId = q.user_id
    if(q.type) where.type = q.type
    if(q.status) where.status = q.status
    if(q.provider) where.provider = q.provider
    const [items,total] = await Promise.all([
      prisma.paymentRequest.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{createdAt:'desc'}, include:{ user:{ select:{ email:true }}} }),
      prisma.paymentRequest.count({ where })
    ])
    return { items, meta:{ page, perPage, total }}
  }

  // UC-PAY-18 details
  @Get('payment-requests/:id')
  async paymentDetail(@Param('id') id: string) {
    const pr = await prisma.paymentRequest.findUnique({ where:{id}, include:{ callbacks: true, user: { select:{ email:true }}}})
    const ledger = await prisma.ledgerEntry.findMany({ where:{ metadata:{ path:['payment_request_id'], equals: id }}}).catch(()=>[])
    return { payment_request: pr, callbacks: pr?.callbacks, ledger_entries: ledger }
  }

  // UC-PAY-10 withdrawals list
  @Get('withdrawals')
  async withdrawals(@Query() q:any){
    const page=parseInt(q.page)||1, perPage=Math.min(parseInt(q.per_page)||50,200)
    const where:any = { type: 'withdrawal' }
    if(q.status) where.status = q.status
    if(q.user_id) where.userId = q.user_id
    if(q.currency) where.currency = q.currency
    const [items,total] = await Promise.all([
      prisma.paymentRequest.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{createdAt:'desc'}, include:{ user:{ select:{ email:true }}} }),
      prisma.paymentRequest.count({ where })
    ])
    return { items, meta:{ page, perPage, total }}
  }

  // UC-PAY-11 approve
  @Post('withdrawals/:id/approve')
  async approve(@Param('id') id: string, @CurrentUser() admin: any, @Req() req:any) {
    const pr = await this.payments.findById(id)
    if (!pr || pr.type !== 'withdrawal' || pr.status !== 'pending') throw new Error('INVALID_STATUS')
    await this.wallet.confirmWithdrawal(pr.userId, pr.currency as any, pr.amount.toString(), `wd_confirm_${pr.id}`)
    await this.payments.updateStatus(id, 'completed', { completedAt: new Date() })
    await this.audit.log({ actorType:'admin', actorId: admin.id, action:'admin.withdrawal.approved', targetType:'payment_request', targetId: id, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    return { ok: true }
  }

  // UC-PAY-12 reject
  @Post('withdrawals/:id/reject')
  async reject(@Param('id') id: string, @Body() body: { reason: string }, @CurrentUser() admin: any, @Req() req:any) {
    const pr = await this.payments.findById(id)
    if (!pr || pr.type !== 'withdrawal' || pr.status !== 'pending') throw new Error('INVALID_STATUS')
    await this.wallet.unlock(pr.userId, pr.currency as any, pr.amount.toString(), `wd_unlock_${pr.id}_${randomUUID()}`)
    await this.payments.updateStatus(id, 'cancelled', { errorMessage: body.reason })
    await this.audit.log({ actorType:'admin', actorId: admin.id, action:'admin.withdrawal.rejected', targetType:'payment_request', targetId: id, payload:{ reason: body.reason }, ipAddress: req.ip })
    return { ok: true }
  }

  // UC-PAY-14 credit
  @Post('wallet/:user_id/credit')
  async adminCredit(@Param('user_id') userId: string, @Body() b: { amount: string; currency: string; reason: string }, @CurrentUser() admin: any, @Req() req:any) {
    if (admin.role !== 'superadmin') throw new Error('FORBIDDEN')
    const res = await this.wallet.credit({
      userId, currency: b.currency as any, amount: b.amount,
      type: 'ADMIN_CREDIT',
      idempotencyKey: `adm_credit_${admin.id}_${Date.now()}`,
      description: b.reason,
      metadata: { admin_id: admin.id }
    })
    await this.audit.log({ actorType:'admin', actorId: admin.id, action:'admin.balance.adjusted', targetType:'user', targetId: userId, payload:{ direction:'credit', amount:b.amount, currency:b.currency, reason:b.reason }, ipAddress: req.ip })
    return res
  }

  // UC-PAY-15 debit
  @Post('wallet/:user_id/debit')
  async adminDebit(@Param('user_id') userId: string, @Body() b: { amount: string; currency: string; reason: string }, @CurrentUser() admin: any, @Req() req:any) {
    if (admin.role !== 'superadmin') throw new Error('FORBIDDEN')
    const res = await this.wallet.debit({
      userId, currency: b.currency as any, amount: b.amount,
      type: 'ADMIN_DEBIT',
      idempotencyKey: `adm_debit_${admin.id}_${Date.now()}`,
      description: b.reason,
      metadata: { admin_id: admin.id }
    })
    await this.audit.log({ actorType:'admin', actorId: admin.id, action:'admin.balance.adjusted', targetType:'user', targetId: userId, payload:{ direction:'debit', amount:b.amount, currency:b.currency, reason:b.reason }, ipAddress: req.ip })
    return res
  }
}
