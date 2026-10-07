import { Injectable } from '@nestjs/common'

import { prisma, type KycDocumentType, type KycStatus, type KycFileType } from '@casino/database'

import {
  type CountedWithdrawal,
  type IKycRepository,
  type KycSubmitInput,
  type KycProfileRow,
} from '../../domain/repositories/kyc.repository'

@Injectable()
export class PrismaKycRepository implements IKycRepository {
  async getByUserId(userId: string): Promise<KycProfileRow | null> {
    return prisma.kycProfile.findUnique({ where: { userId }, include: { documents: true } })
  }
  async getById(id: string): Promise<
    | (KycProfileRow & {
        user: { id: string; email: string | null; createdAt: Date; status: string }
      })
    | null
  > {
    return prisma.kycProfile.findUnique({
      where: { id },
      include: {
        documents: true,
        user: { select: { id: true, email: true, createdAt: true, status: true } },
      },
    })
  }
  async submit(input: KycSubmitInput): Promise<KycProfileRow> {
    return prisma.kycProfile.upsert({
      where: { userId: input.userId },
      update: {
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        country: input.country,
        documentType: input.documentType as KycDocumentType,
        documentNumber: input.documentNumber,
        documentExpiry: input.documentExpiry ?? null,
        status: 'pending',
        submittedAt: new Date(),
        rejectionReason: null,
      },
      create: {
        userId: input.userId,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        country: input.country,
        documentType: input.documentType as KycDocumentType,
        documentNumber: input.documentNumber,
        documentExpiry: input.documentExpiry ?? null,
        status: 'pending',
        submittedAt: new Date(),
      },
    })
  }
  async addDocument(
    kycProfileId: string,
    doc: {
      documentType: string
      fileUrl: string
      fileName?: string
      fileSize?: number
      mimeType?: string
    },
  ): Promise<void> {
    await prisma.kycDocument.create({
      data: {
        kycProfileId,
        documentType: doc.documentType as KycFileType,
        fileUrl: doc.fileUrl,
        fileName: doc.fileName ?? null,
        fileSize: doc.fileSize ?? null,
        mimeType: doc.mimeType ?? null,
      },
    })
  }
  async getStatus(userId: string): Promise<{
    status: string
    submittedAt: Date | null
    rejectionReason: string | null
    documents: string[]
  } | null> {
    const p = await prisma.kycProfile.findUnique({
      where: { userId },
      include: { documents: true },
    })
    if (!p) {
      return { status: 'not_started', submittedAt: null, rejectionReason: null, documents: [] }
    }
    return {
      status: p.status,
      submittedAt: p.submittedAt,
      rejectionReason: p.rejectionReason,
      documents: p.documents.map((d: { documentType: string }) => d.documentType),
    }
  }
  async listAdmin(
    status?: string,
    page = 1,
    perPage = 20,
  ): Promise<{ items: KycProfileRow[]; total: number }> {
    const where = status ? { status: status as KycStatus } : {}
    const [items, total] = await Promise.all([
      prisma.kycProfile.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { submittedAt: 'desc' },
        include: { user: { select: { email: true } } },
      }),
      prisma.kycProfile.count({ where }),
    ])
    return { items, total }
  }
  async setStatus(args: {
    id: string
    status: 'approved' | 'rejected' | 'requires_resubmission'
    reason?: string
    reviewedBy?: string
  }): Promise<void> {
    const { id, status, reason, reviewedBy } = args
    await prisma.kycProfile.update({
      where: { id },
      data: {
        status: status as KycStatus,
        rejectionReason: reason ?? null,
        reviewedBy: reviewedBy ?? null,
        approvedAt: status === 'approved' ? new Date() : null,
        rejectedAt: status === 'rejected' ? new Date() : null,
      },
    })
  }
  /**
   * Сумма пополнений игрока в RUB — база порога без KYC.
   *
   * Источник — только completed-заявки `type='deposit'`: это деньги, которые
   * игрок принёс сам. `amount_rub` крипто-заявки вебхук пересчитывает по
   * фактическому `actually_paid` (GAP-72), поэтому сумма совпадает с тем, что
   * легло в кошелёк, а не с оценкой курса на интенте.
   *
   * `ADMIN_CREDIT` (проводка кошелька из админки) в базу НЕ входит: это не
   * деньги игрока, а начисление платформы, и вывод всё равно заперт за
   * `assertCanWithdraw`. Включать ли его в AML-оборот — решение комплаенса
   * (GAP-49), а не техники: менять надо вместе с формулировкой порога.
   */
  async getTotalDepositedRub(userId: string): Promise<string> {
    const res = await prisma.paymentRequest.aggregate({
      where: { userId, type: 'deposit', status: 'completed' },
      _sum: { amountRub: true, amount: true },
    })
    const sum = res._sum.amountRub ?? 0
    return String(sum)
  }
  /**
   * Основание порога «вывод без верификации» — см. IKycRepository.
   *
   * Читаем `payment_requests` напрямую (деньги-чтения другому модулю разрешены
   * по ADR GAP-51; так же устроен getTotalDepositedRub). Сумму в рубли здесь
   * НЕ считаем: `_sum(amountRub)` по выводу сложил бы NULL-ы в 0 и показал бы
   * «ничего не выведено» для всех заявок до 2026-10-07, а `_sum(amount)` смешал
   * бы ₽, USDT и BTC в одно число.
   */
  async listCountedWithdrawals(userId: string): Promise<CountedWithdrawal[]> {
    const rows = await prisma.paymentRequest.findMany({
      where: {
        userId,
        type: 'withdrawal',
        status: { in: ['pending', 'processing', 'completed'] },
      },
      select: { currency: true, amount: true, amountRub: true },
    })
    return rows.map((row) => ({
      currency: row.currency,
      amount: String(row.amount),
      amountRub: row.amountRub === null ? null : String(row.amountRub),
    }))
  }
}
