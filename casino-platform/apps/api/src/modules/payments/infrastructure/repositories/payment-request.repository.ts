import { Injectable } from '@nestjs/common'

import { prisma, type Prisma, type PaymentProvider , type PaymentStatus } from '@casino/database'

@Injectable()
export class PaymentRequestRepository {
  create(data: Prisma.PaymentRequestCreateInput) {
    return prisma.paymentRequest.create({ data })
  }
  findById(id: string) {
    return prisma.paymentRequest.findUnique({ where: { id } })
  }
  findByExternalId(externalId: string, provider: string) {
    return prisma.paymentRequest.findFirst({ where: { externalId, provider: provider as PaymentProvider } })
  }
  updateStatus(id: string, status: PaymentStatus, extra: { completedAt?: Date; externalStatus?: string; errorMessage?: string } = {}) {
    return prisma.paymentRequest.update({
      where: { id },
      data: { status, updatedAt: new Date(), ...extra },
    })
  }
  listUser(args: {
    userId: string
    type?: 'deposit' | 'withdrawal'
    page: number
    perPage: number
  }) {
    const { userId, type, page, perPage } = args
    const where: Prisma.PaymentRequestWhereInput = { userId }
    if (type) {
      where.type = type
    }
    return Promise.all([
      prisma.paymentRequest.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.paymentRequest.count({ where }),
    ])
  }
  saveCallback(data: {
    provider: string
    externalId?: string
    paymentRequestId?: string
    rawHeaders: Record<string, string>
    rawBody: string
    ipAddress?: string
  }) {
    return prisma.paymentCallback.create({
      data: {
        provider: data.provider,
        externalId: data.externalId ?? null,
        paymentRequestId: data.paymentRequestId ?? null,
        rawHeaders: data.rawHeaders ?? {},
        rawBody: data.rawBody,
        ipAddress: data.ipAddress ?? null,
        processed: false,
      },
    })
  }
  markCallbackProcessed(id: string, result?: string) {
    return prisma.paymentCallback.update({
      where: { id },
      data: { processed: true, processingResult: result ?? null },
    })
  }
}
