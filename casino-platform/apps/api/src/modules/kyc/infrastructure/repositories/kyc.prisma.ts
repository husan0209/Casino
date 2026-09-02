import { Injectable } from '@nestjs/common'

import { prisma, type KycDocumentType, type KycStatus , type KycFileType } from '@casino/database'

import { type IKycRepository, type KycSubmitInput } from '../../domain/repositories/kyc.repository'

@Injectable()
export class PrismaKycRepository implements IKycRepository {
  async getByUserId(userId: string) {
    return prisma.kycProfile.findUnique({ where: { userId }, include: { documents: true } })
  }
  async getById(id: string) {
    return prisma.kycProfile.findUnique({
      where: { id },
      include: {
        documents: true,
        user: { select: { id: true, email: true, createdAt: true, status: true } },
      },
    })
  }
  async submit(input: KycSubmitInput) {
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
  ) {
    return prisma.kycDocument.create({
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
  async getStatus(userId: string) {
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
  async listAdmin(status?: string, page = 1, perPage = 20) {
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
  }) {
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
  async getTotalDepositedRub(userId: string): Promise<string> {
    const res = await prisma.paymentRequest.aggregate({
      where: { userId, type: 'deposit', status: 'completed' },
      _sum: { amountRub: true, amount: true },
    })
    const sum = res._sum.amountRub ?? 0
    return String(sum)
  }
}
