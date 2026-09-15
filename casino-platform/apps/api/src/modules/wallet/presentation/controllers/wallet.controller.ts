import { Controller, Get, Param, Query, UseGuards, UsePipes } from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'
import { type WalletBalanceView, WalletFacade } from '@modules/wallet/application/wallet.facade'

import { prisma, type Prisma } from '@casino/database'
import { type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { ListTransactionsSchema, type ListTransactionsDto, type TransactionRow } from '../dto/list-transactions.dto'

@UseGuards(AuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletFacade: WalletFacade) {}

  @Get('balances')
  async balances(@CurrentUser() currentUser: { id: string }): Promise<{ currency: string; balance: string; locked: string; available: string; }[]> {
    const rows = await this.walletFacade.getBalances(currentUser.id)
    return rows.map((row) => ({
      currency: row.currency,
      balance: row.balance,
      locked: row.locked,
      available: money.subtract(row.balance, row.locked),
    }))
  }

  @Get('balances/:currency')
  async balance(@CurrentUser() currentUser: { id: string }, @Param('currency') currency: string): Promise<WalletBalanceView> {
    return this.walletFacade.getBalance(currentUser.id, currency as Currency)
  }

  @Get('transactions')
  @UsePipes(new ZodValidationPipe(ListTransactionsSchema))
  async transactions(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: ListTransactionsDto,
  ): Promise<{ data: TransactionRow[]; meta: { page: number; per_page: number; total: number; total_pages: number; hasNext: boolean; hasPrev: boolean } }> {
    const page = parseInt(queryParams.page ?? '1', 10) || 1
    const perPage = Math.min(parseInt(queryParams.per_page || '20', 10) || 20, 100)

    const where: Prisma.LedgerEntryWhereInput = {
      userId: currentUser.id,
      ...this.periodFilter(queryParams.from, queryParams.to),
    }
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

    const data = items.map((entry) => ({
      id: entry.id,
      transaction_id: entry.transactionId,
      type: entry.type,
      amount: entry.amount.toString(),
      currency: entry.walletAccount.currency,
      balance_before: entry.balanceBefore.toString(),
      balance_after: entry.balanceAfter.toString(),
      description: entry.description,
      metadata: entry.metadata,
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

  /**
   * Период §11: `from` — сутки целиком с начала, `to` — включая весь день.
   * Формат дат уже проверен Zod-схемой (YYYY-MM-DD), поэтому здесь только сборка.
   */
  private periodFilter(from?: string, to?: string): Pick<Prisma.LedgerEntryWhereInput, 'createdAt'> {
    if (from === undefined && to === undefined) {
      return {}
    }
    return {
      createdAt: {
        ...(from !== undefined && { gte: new Date(`${from}T00:00:00.000Z`) }),
        ...(to !== undefined && { lte: new Date(`${to}T23:59:59.999Z`) }),
      },
    }
  }
}
