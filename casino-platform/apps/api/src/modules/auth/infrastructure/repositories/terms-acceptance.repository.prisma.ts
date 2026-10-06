import { createHash } from 'crypto'

import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'
import { type LegalDocumentType } from '@casino/shared-types'

import {
  type ITermsAcceptanceRepository,
  type TermsAcceptanceInput,
  type TermsAcceptanceView,
} from '../../domain/repositories/terms-acceptance.repository'

/**
 * Необратимый отпечаток IP (Terms §4): журнал доказывает факт акцепта, но не
 * хранит адрес клиента. Сырой IP остаётся там, где он был и раньше — в `sessions`
 * того же входа, и строки журнала связываются с сессией по времени.
 */
export function fingerprintIp(ip: string | null): string {
  // Пустой адрес (например, внутренний вызов) — не «нет отпечатка», а отдельный
  // детерминированный значение: поле NOT NULL, и NULL в нём означал бы «данные
  // потеряны», а не «адреса не было».
  return createHash('sha256').update(ip ?? 'unknown').digest('hex')
}

@Injectable()
export class PrismaTermsAcceptanceRepository implements ITermsAcceptanceRepository {
  async recordMany(entries: TermsAcceptanceInput[]): Promise<void> {
    if (entries.length === 0) {
      return
    }
    await prisma.termsAcceptance.createMany({
      data: entries.map((entry) => ({
        userId: entry.userId,
        document: entry.document,
        version: entry.version,
        ipHash: fingerprintIp(entry.ip),
        userAgent: entry.userAgent,
      })),
      skipDuplicates: true,
    })
  }

  async listForUser(userId: string): Promise<TermsAcceptanceView[]> {
    const rows = await prisma.termsAcceptance.findMany({
      where: { userId },
      orderBy: { acceptedAt: 'desc' },
      select: { id: true, document: true, version: true, acceptedAt: true },
    })
    return rows.map((row) => ({
      id: row.id,
      document: row.document as LegalDocumentType,
      version: row.version,
      acceptedAt: row.acceptedAt,
    }))
  }
}
