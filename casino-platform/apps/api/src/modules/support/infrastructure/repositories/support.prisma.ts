import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
import { ISupportRepository, TicketStatus, TicketCategory, TicketPriority } from '../../domain/repositories/support.repository'
@Injectable()
export class PrismaSupportRepository implements ISupportRepository {
  async countOpenByUser(userId: string) {
    return prisma.supportTicket.count({ where: { userId, status: { in: ['open','in_progress','waiting_user'] }}})
  }
  async createTicket(userId: string, subject: string, category: TicketCategory, message: string) {
    const ticket = await prisma.$transaction(async tx => {
      const t = await tx.supportTicket.create({ data: { userId, subject, category: category as any, status: 'open', priority: 'normal' }})
      await tx.supportMessage.create({ data: { ticketId: t.id, senderType: 'user', senderId: userId, message, attachments: [], isInternal: false }})
      return t
    })
    return { id: ticket.id }
  }
  async listUserTickets(userId: string, status?: TicketStatus, page = 1, perPage = 20) {
    const where:any = { userId }; if (status) where.status = status
    const [items, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where, skip: (page-1)*perPage, take: perPage, orderBy: { updatedAt: 'desc' },
        select: { id:true, subject:true, category:true, status:true, priority:true, createdAt:true, updatedAt:true,
          _count: { select: { messages: true } } }
      }),
      prisma.supportTicket.count({ where })
    ])
    return { items, total }
  }
  async getTicketForUser(ticketId: string, userId: string) {
    return prisma.supportTicket.findFirst({ where: { id: ticketId, userId }})
  }
  async addMessage(ticketId: string, senderType: 'user'|'admin', senderId: string, message: string, isInternal = false, attachments: any[] = []) {
    const m = await prisma.supportMessage.create({ data: { ticketId, senderType, senderId, message, attachments, isInternal }})
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { updatedAt: new Date(), status: senderType==='admin' && !isInternal ? 'waiting_user' : undefined }})
    return m
  }
  async listMessages(ticketId: string, includeInternal: boolean) {
    return prisma.supportMessage.findMany({
      where: { ticketId, ...(includeInternal ? {} : { isInternal: false }) },
      orderBy: { createdAt: 'asc' }
    })
  }
  async closeTicket(ticketId: string, closedBy: 'user'|'admin') {
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'closed', closedAt: new Date(), closedBy }})
  }
  async listAdmin(f: any) {
    const page = f.page || 1, perPage = Math.min(f.perPage || 20, 100)
    const where:any = {}
    if (f.status) where.status = f.status
    if (f.priority) where.priority = f.priority
    if (f.category) where.category = f.category
    if (f.assignedTo) where.assignedTo = f.assignedTo
    if (f.userId) where.userId = f.userId
    if (f.search) where.OR = [{ subject: { contains: f.search, mode: 'insensitive' }}]
    const [items, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip: (page-1)*perPage, take: perPage,
        orderBy: { updatedAt: 'desc' },
        include: { user: { select: { email: true }}, assignee: { select: { email: true, firstName: true }}, _count: { select: { messages: true }}}
      }),
      prisma.supportTicket.count({ where })
    ])
    return { items, total }
  }
  async getAdmin(ticketId: string) {
    return prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { user: { select: { id:true, email:true }}, messages: { orderBy: { createdAt: 'asc' }}, assignee: true }
    })
  }
  async assign(ticketId: string, adminId: string | null) {
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { assignedTo: adminId }})
  }
  async setPriority(ticketId: string, priority: TicketPriority) {
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { priority: priority as any }})
  }
  async setStatus(ticketId: string, status: TicketStatus) {
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: status as any }})
  }
}
