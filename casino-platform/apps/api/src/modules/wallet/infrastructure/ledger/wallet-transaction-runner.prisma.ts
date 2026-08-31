import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import { type IWalletTransactionRunner } from '../../domain/repositories/wallet.repository'

import type { Prisma } from '@prisma/client'

/**
 * P0 #3: единственная точка открытия внешних денежных транзакций.
 * Serializable — тот же уровень, что раньше использовал каждый внутренний
 * $transaction ledger'а; при передаче tx в CreditInput внутренние транзакции
 * не открываются (Prisma запрещает вложенные).
 */
@Injectable()
export class PrismaWalletTransactionRunner implements IWalletTransactionRunner {
  runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn, { isolationLevel: 'Serializable' })
  }
}
