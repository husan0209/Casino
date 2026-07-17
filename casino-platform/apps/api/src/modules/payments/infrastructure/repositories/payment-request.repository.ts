import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
@Injectable()
export class PaymentRequestRepository {
  create(data: any) { return prisma.paymentRequest.create({ data }) }
  findById(id: string) { return prisma.paymentRequest.findUnique({ where: { id }}) }
  findByExternalId(externalId: string, provider: string) {
    return prisma.paymentRequest.findFirst({ where: { externalId, provider: provider as any }})
  }
  updateStatus(id: string, status: any, extra: any = {}) {
    return prisma.paymentRequest.update({ where: { id }, data: { status, updatedAt: new Date(), ...extra }})
  }
  listUser(userId: string, type?: 'deposit'|'withdrawal', page = 1, perPage = 20) {
    const where:any = { userId }; if (type) where.type = type
    return Promise.all([
      prisma.paymentRequest.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{createdAt:'desc'}}),
      prisma.paymentRequest.count({ where })
    ])
  }
  saveCallback(data: { provider: string; externalId?: string; paymentRequestId?: string; rawHeaders: any; rawBody: string; ipAddress?: string }) {
    return prisma.paymentCallback.create({ data: { provider: data.provider, externalId: data.externalId ?? null, paymentRequestId: data.paymentRequestId ?? null, rawHeaders: data.rawHeaders ?? {}, rawBody: data.rawBody, ipAddress: data.ipAddress ?? null, processed: false }})
  }
  markCallbackProcessed(id: string, result?: string) {
    return prisma.paymentCallback.update({ where: { id }, data: { processed: true, processingResult: result ?? null }})
  }
}
