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

/** GAP-57: Serializable-конфликт Postgres приходит как Prisma P2034. */
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 50

function isSerializationConflict(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'P2034'
}

@Injectable()
export class PrismaWalletTransactionRunner implements IWalletTransactionRunner {
  async runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    // GAP-57 (найдено прогоном GAP-47, 2026-09-27): конфликт Serializable откатывает
    // транзакцию СУБД ДО app-кода — здесь он не был ретраен вовсе, и профиль
    // «много ставок/сек на один кошелёк» падал на первом же конфликте (28 из 30
    // параллельных bets). Тело внешней транзакции идемпотентно по дизайну (дедуп
    // по внешним id/idempotencyKey — раунд, проводка и gameTransaction), поэтому
    // повторный прогон не даёт двойного эффекта; семантика — как у withRetry в
    // wallet.ledger.prisma.
    for (let attempt = 1; ; attempt++) {
      try {
        return await prisma.$transaction(fn, { isolationLevel: 'Serializable' })
      } catch (e) {
        if (!isSerializationConflict(e) || attempt >= MAX_ATTEMPTS) {
          throw e
        }
        await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * attempt * attempt))
      }
    }
  }
}
