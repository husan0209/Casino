import { Injectable } from '@nestjs/common'

import { prisma, type Prisma, type PaymentCallback, type PaymentProvider, type PaymentRequest, type PaymentStatus } from '@casino/database'
export type { PaymentRequest, PaymentProvider, PaymentStatus, PaymentType } from '@casino/database'


@Injectable()
export class PaymentRequestRepository {
  create(data: Prisma.PaymentRequestUncheckedCreateInput): Promise<PaymentRequest> {
    return prisma.paymentRequest.create({ data })
  }
  findById(id: string): Promise<PaymentRequest | null> {
    return prisma.paymentRequest.findUnique({ where: { id } })
  }
  findByExternalId(externalId: string, provider: string): Promise<PaymentRequest | null> {
    return prisma.paymentRequest.findFirst({ where: { externalId, provider: provider as PaymentProvider } })
  }
  updateStatus(
    id: string,
    status: PaymentStatus,
    extra: {
      completedAt?: Date | undefined
      externalStatus?: string | undefined
      errorMessage?: string | undefined
      externalId?: string | undefined
      paymentUrl?: string | undefined
    } = {},
  ): Promise<PaymentRequest> {
    // exactOptionalPropertyTypes: Prisma не принимает явный undefined —
    // включаем в data только заданные поля (undefined -> отсутствие -> NULL)
    return prisma.paymentRequest.update({
      where: { id },
      data: {
        status,
        updatedAt: new Date(),
        ...(extra.completedAt !== undefined && { completedAt: extra.completedAt }),
        ...(extra.externalStatus !== undefined && { externalStatus: extra.externalStatus }),
        ...(extra.errorMessage !== undefined && { errorMessage: extra.errorMessage }),
        ...(extra.externalId !== undefined && { externalId: extra.externalId }),
        ...(extra.paymentUrl !== undefined && { paymentUrl: extra.paymentUrl }),
      },
    })
  }
  listUser(args: {
    userId: string
    type?: 'deposit' | 'withdrawal'
    page: number
    perPage: number
  }): Promise<[PaymentRequest[], number]> {
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
  }): Promise<PaymentCallback> {
    return prisma.paymentCallback.create({
      data: {
        provider: data.provider,
        externalId: data.externalId ?? null,
        paymentRequestId: data.paymentRequestId ?? null,
        rawHeaders: data.rawHeaders,
        rawBody: data.rawBody,
        ipAddress: data.ipAddress ?? null,
        processed: false,
      },
    })
  }
  markCallbackProcessed(id: string, result?: string): Promise<PaymentCallback> {
    return prisma.paymentCallback.update({
      where: { id },
      data: { processed: true, processingResult: result ?? null },
    })
  }
}
