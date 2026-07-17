import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
import { IKycRepository, KycSubmitInput } from '../../domain/repositories/kyc.repository'
@Injectable()
export class PrismaKycRepository implements IKycRepository {
  async getByUserId(userId: string) { return prisma.kycProfile.findUnique({ where: { userId }, include: { documents: true }}) }
  async submit(input: KycSubmitInput) {
    return prisma.kycProfile.upsert({
      where: { userId: input.userId },
      update: {
        firstName: input.firstName, lastName: input.lastName, dateOfBirth: input.dateOfBirth,
        country: input.country, documentType: input.documentType as any, documentNumber: input.documentNumber,
        documentExpiry: input.documentExpiry ?? null, status: 'pending', submittedAt: new Date(),
        rejectionReason: null
      },
      create: {
        userId: input.userId, firstName: input.firstName, lastName: input.lastName,
        dateOfBirth: input.dateOfBirth, country: input.country, documentType: input.documentType as any,
        documentNumber: input.documentNumber, documentExpiry: input.documentExpiry ?? null,
        status: 'pending', submittedAt: new Date()
      }
    })
  }
  async addDocument(kycProfileId: string, doc: any) {
    return prisma.kycDocument.create({ data: { kycProfileId, documentType: doc.documentType, fileUrl: doc.fileUrl, fileName: doc.fileName ?? null, fileSize: doc.fileSize ?? null, mimeType: doc.mimeType ?? null }})
  }
  async getStatus(userId: string) {
    const p = await prisma.kycProfile.findUnique({ where: { userId }, include: { documents: true }})
    if (!p) return { status: 'not_started', submittedAt: null, rejectionReason: null, documents: [] }
    return { status: p.status, submittedAt: p.submittedAt, rejectionReason: p.rejectionReason, documents: p.documents.map(d => d.documentType) }
  }
  async listAdmin(status?: string, page = 1, perPage = 20) {
    const where = status ? { status: status as any } : {}
    const [items, total] = await Promise.all([
      prisma.kycProfile.findMany({ where, skip: (page-1)*perPage, take: perPage, orderBy: { submittedAt: 'desc' }, include: { user: { select: { email: true }}} }),
      prisma.kycProfile.count({ where })
    ])
    return { items, total }
  }
  async setStatus(id: string, status: 'approved'|'rejected'|'requires_resubmission', reason?: string, reviewedBy?: string) {
    await prisma.kycProfile.update({
      where: { id },
      data: {
        status: status as any,
        rejectionReason: reason ?? null,
        reviewedBy: reviewedBy ?? null,
        approvedAt: status === 'approved' ? new Date() : null,
        rejectedAt: status === 'rejected' ? new Date() : null,
      }
    })
  }
  async getTotalDepositedRub(userId: string): Promise<string> {
    const res = await prisma.paymentRequest.aggregate({
      where: { userId, type: 'deposit', status: 'completed' },
      _sum: { amountRub: true, amount: true }
    })
    const sum = res._sum.amountRub ?? 0
    return String(sum)
  }
}
