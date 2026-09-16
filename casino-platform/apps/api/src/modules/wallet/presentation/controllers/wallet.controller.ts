import { Controller, Get, Param, Query, UseGuards, UsePipes } from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { AuthGuard } from '@modules/auth/presentation/guards/auth.guard'
import { type WalletBalanceView, WalletFacade } from '@modules/wallet/application/wallet.facade'

import { type LedgerEntryType, prisma, type Prisma } from '@casino/database'
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

    const data = await this.attachPaymentStatuses(
      currentUser.id,
      items.map((entry) => WalletController.toRow(entry)),
    )

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

  /** Строка ответа из записи ledger (деньги — строки, Decimal → string). */
  private static toRow(entry: {
    id: string
    transactionId: string
    type: LedgerEntryType
    amount: Prisma.Decimal
    balanceBefore: Prisma.Decimal
    balanceAfter: Prisma.Decimal
    description: string | null
    metadata: Prisma.JsonValue
    createdAt: Date
    walletAccount: { currency: string }
  }): TransactionRow {
    return {
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
      payment_status: null,
    }
  }

  /**
   * GAP-55 (§11 «статус»): статус заявки для заморозки/списания/разблокировки
   * вывода. одним запросом (не N+1) и только для своего пользователя (IDOR).
   * Проводки без ссылки (депозит/ставка/выигрыш, а также строки, записанные
   * до GAP-55) остаются с payment_status: null — не выдумываем статус.
   */
  private async attachPaymentStatuses(
    userId: string,
    rows: TransactionRow[],
  ): Promise<TransactionRow[]> {
    const references = rows.map((row) => paymentRequestIdOf(row.metadata))
    const ids = [...new Set(references.filter((id): id is string => id !== null))]
    if (ids.length === 0) {
      return rows
    }
    const requests = await prisma.paymentRequest.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, status: true },
    })
    const statusById = new Map(requests.map((request) => [request.id, request.status]))
    return rows.map((row, index) => ({
      ...row,
      payment_status: statusById.get(references[index] ?? '') ?? null,
    }))
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

/**
 * Ссылка на payment_request из метаданных проводки (GAP-55). Значение могло
 * приходить и как число-строка, и как число — нормализуем к строке uuid.
 */
function paymentRequestIdOf(metadata: Prisma.JsonValue): string | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null
  }
  const value = metadata['payment_request_id']
  return typeof value === 'string' && value.length > 0 ? value : null
}
