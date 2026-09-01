import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'

import { prisma } from '@casino/database'
import type { Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'


import { WalletFacade } from '../../application/wallet.facade'

@UseGuards(AuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletFacade: WalletFacade) {}

  @Get('balances')
  async balances(@CurrentUser() currentUser: { id: string }) {
    const rows = await this.walletFacade.getBalances(currentUser.id)
    return rows.map((row) => ({
      currency: row.currency,
      balance: row.balance,
      locked: row.locked,
      available: money.subtract(row.balance, row.locked),
    }))
  }

  @Get('balances/:currency')
  async balance(@CurrentUser() currentUser: { id: string }, @Param('currency') currency: string) {
    return this.walletFacade.getBalance(currentUser.id, currency as Currency)
  }

  @Get('transactions')
  async transactions(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: { page?: string; per_page?: string; currency?: string; type?: string },
  ) {
    const page = parseInt(queryParams.page || '1', 10) || 1
    const perPage = Math.min(parseInt(queryParams.per_page || '20', 10) || 20, 100)

    const where: any = { userId: currentUser.id }
    if (queryParams.currency) {
      where.walletAccount = { currency: queryParams.currency }
    }
    if (queryParams.type) {
      where.type = queryParams.type
    }

    const [items, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { walletAccount: { select: { currency: true } } },
      }),
      prisma.ledgerEntry.count({ where }),
    ])

    const data = items.map((entry: { [key: string]: any }) => ({
      id: entry.id,
      transaction_id: entry.transactionId,
      type: entry.type,
      amount: entry.amount.toString(),
      currency: entry.walletAccount.currency,
      balance_before: entry.balanceBefore.toString(),
      balance_after: entry.balanceAfter.toString(),
      description: entry.description,
      created_at: entry.createdAt,
    }))

    return {
      data,
      meta: {
        page,
        per_page: perPage,
        total,
        total_pages: Math.ceil(total / perPage),
        hasNext: page * perPage < total,
        hasPrev: page > 1,
      },
    }
  }
}
