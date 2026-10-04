import { Injectable } from '@nestjs/common'

import {
  prisma,
  type Prisma,
  type PaymentCallback,
  type PaymentProvider,
  type PaymentRequest,
  type PaymentStatus,
  type PaymentType,
} from '@casino/database'

import type {
  IPaymentRequestRepository,
  PaymentRequestAdminRow,
  PaymentRequestDetailRow,
} from '../../domain/payments.ports'

export type { PaymentRequest, PaymentProvider, PaymentStatus, PaymentType } from '@casino/database'

@Injectable()
export class PaymentRequestRepository implements IPaymentRequestRepository {
  create(data: Prisma.PaymentRequestUncheckedCreateInput): Promise<PaymentRequest> {
    return prisma.paymentRequest.create({ data })
  }
  findById(id: string): Promise<PaymentRequest | null> {
    return prisma.paymentRequest.findUnique({ where: { id } })
  }
  findByExternalId(externalId: string, provider: string): Promise<PaymentRequest | null> {
    return prisma.paymentRequest.findFirst({
      where: { externalId, provider: provider as PaymentProvider },
    })
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
      amountRub?: string | undefined
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
        ...(extra.amountRub !== undefined && { amountRub: extra.amountRub }),
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

  /**
   * Админский список заявок (гард G27: SQL владельца таблицы, не контроллера).
   * Фильтры попадают в `where` только когда пришли — пустая строка query не
   * должна превращаться в `status: ''` и ронять запрос.
   */
  listAdmin(args: {
    userId?: string | undefined
    type?: PaymentType | undefined
    status?: PaymentStatus | undefined
    provider?: PaymentProvider | undefined
    currency?: string | undefined
    page: number
    perPage: number
  }): Promise<[PaymentRequestAdminRow[], number]> {
    const where: Prisma.PaymentRequestWhereInput = {
      ...(args.userId !== undefined && { userId: args.userId }),
      ...(args.type !== undefined && { type: args.type }),
      ...(args.status !== undefined && { status: args.status }),
      ...(args.provider !== undefined && { provider: args.provider }),
      ...(args.currency !== undefined && { currency: args.currency }),
    }
    return Promise.all([
      prisma.paymentRequest.findMany({
        where,
        skip: (args.page - 1) * args.perPage,
        take: args.perPage,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } },
      }),
      prisma.paymentRequest.count({ where }),
    ])
  }

  findDetail(id: string): Promise<PaymentRequestDetailRow | null> {
    return prisma.paymentRequest.findUnique({
      where: { id },
      include: { callbacks: true, user: { select: { email: true } } },
    })
  }

  /**
   * Условное истечение (порт + гард G24): `status: 'pending'` в where, поэтому
   * гонка с вебхуком не затирает completed. Условие держится здесь, а не в
   * вызывающем коде: читатель не может гарантировать, что заявка ещё pending.
   */
  async expireIfPending(id: string): Promise<number> {
    const res = await prisma.paymentRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'expired' },
    })
    return res.count
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
