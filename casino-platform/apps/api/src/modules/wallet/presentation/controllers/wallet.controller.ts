import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../../auth/presentation/guards/auth.guard'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { WalletFacade } from '../../application/wallet.facade'
import { prisma } from '@casino/database'

@UseGuards(AuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletFacade) {}
  @Get('balances')
  async balances(@CurrentUser() u: any) {
    const rows = await this.wallet.getBalances(u.id)
    const { money } = await import('@casino/shared-utils')
    return rows.map(r => ({ currency: r.currency, balance: r.balance, locked: r.locked, available: money.subtract(r.balance, r.locked) }))
  }
  @Get('balances/:currency')
  async balance(@CurrentUser() u: any, @Param('currency') currency: string) {
    return this.wallet.getBalance(u.id, currency as any)
  }
  @Get('transactions')
  async transactions(@CurrentUser() u: any, @Query() q: any) {
    const page = parseInt(q.page)||1, perPage = Math.min(parseInt(q.per_page)||20,100)
    const where:any = { userId: u.id }
    if (q.currency) where.walletAccount = { currency: q.currency }
    if (q.type) where.type = q.type
    const [items,total] = await Promise.all([
      prisma.ledgerEntry.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{ createdAt:'desc' }, include:{ walletAccount:{ select:{ currency:true }}} }),
      prisma.ledgerEntry.count({ where })
    ])
    const data = items.map(e => ({
      id: e.id, transaction_id: e.transactionId, type: e.type,
      amount: e.amount.toString(), currency: e.walletAccount.currency,
      balance_before: e.balanceBefore.toString(), balance_after: e.balanceAfter.toString(),
      description: e.description, created_at: e.createdAt,
    }))
    return { data, meta: { page, per_page: perPage, total, total_pages: Math.ceil(total/perPage), hasNext: page*perPage < total, hasPrev: page > 1 }}
  }
}
