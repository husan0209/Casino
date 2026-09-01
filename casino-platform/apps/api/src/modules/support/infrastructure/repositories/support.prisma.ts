import { Injectable } from '@nestjs/common'

import { prisma, type SupportTicketCategory, type SupportTicketPriority, type SupportTicketStatus } from '@casino/database'

import {
  type ISupportRepository,
  type TicketStatus,
  type TicketCategory,
  type TicketPriority,
} from '../../domain/repositories/support.repository'

@Injectable()
export class PrismaSupportRepository implements ISupportRepository {
  async countOpenByUser(userId: string) {
    return prisma.supportTicket.count({
      where: { userId, status: { in: ['open', 'in_progress', 'waiting_user'] } },
    })
  }
  async createTicket(args: {
    userId: string
    subject: string
    category: TicketCategory
    message: string
  }) {
    const { userId, subject, category, message } = args
    const ticket = await prisma.$transaction(async (tx: { [k: string]: any }) => {
      const t = await tx.supportTicket.create({
        data: { userId, subject, category: category as SupportTicketCategory, status: 'open', priority: 'normal' },
      })
      await tx.supportMessage.create({
        data: {
          ticketId: t.id,
          senderType: 'user',
          senderId: userId,
          message,
          attachments: [],
          isInternal: false,
        },
      })
      return t
    })
    return { id: ticket.id }
  }
  async listUserTickets(args: { userId: string; status?: TicketStatus; page: number; perPage: number }) {
    const { userId, status, page, perPage } = args
    const where: any = { userId }
    if (status) {
      where.status = status
    }
    const [items, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          subject: true,
          category: true,
          status: true,
          priority: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { messages: true } },
        },
      }),
      prisma.supportTicket.count({ where }),
    ])
    return { items, total }
  }
  async getTicketForUser(ticketId: string, userId: string) {
    return prisma.supportTicket.findFirst({ where: { id: ticketId, userId } })
  }
  async addMessage(args: {
    ticketId: string
    senderType: 'user' | 'admin'
    senderId: string
    message: string
    isInternal?: boolean
    attachments?: any[]
  }) {
    const { ticketId, senderType, senderId, message } = args
    const isInternal = args.isInternal ?? false
    const attachments = args.attachments ?? []
    const m = await prisma.supportMessage.create({
      data: { ticketId, senderType, senderId, message, attachments, isInternal },
    })
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        updatedAt: new Date(),
        ...(senderType === 'admin' && !isInternal && { status: 'waiting_user' as const }),
      },
    })
    return m
  }
  async listMessages(ticketId: string, includeInternal: boolean) {
    return prisma.supportMessage.findMany({
      where: { ticketId, ...(includeInternal ? {} : { isInternal: false }) },
      orderBy: { createdAt: 'asc' },
    })
  }
  async closeTicket(ticketId: string, closedBy: 'user' | 'admin') {
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: 'closed', closedAt: new Date(), closedBy },
    })
  }
  async listAdmin(f: any) {
    const page = f.page || 1,
      perPage = Math.min(f.perPage || 20, 100)
    const where: any = {}
    if (f.status) {
      where.status = f.status
    }
    if (f.priority) {
      where.priority = f.priority
    }
    if (f.category) {
      where.category = f.category
    }
    if (f.assignedTo) {
      where.assignedTo = f.assignedTo
    }
    if (f.userId) {
      where.userId = f.userId
    }
    if (f.search) {
      where.OR = [{ subject: { contains: f.search, mode: 'insensitive' } }]
    }
    const [items, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { updatedAt: 'desc' },
        include: {
          user: { select: { email: true } },
          assignee: { select: { email: true, firstName: true } },
          _count: { select: { messages: true } },
        },
      }),
      prisma.supportTicket.count({ where }),
    ])
    return { items, total }
  }
  async getAdmin(ticketId: string) {
    return prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        assignee: true,
      },
    })
  }
  async assign(ticketId: string, adminId: string | null) {
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { assignedTo: adminId } })
  }
  async setPriority(ticketId: string, priority: TicketPriority) {
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { priority: priority as SupportTicketPriority },
    })
  }
  async setStatus(ticketId: string, status: TicketStatus) {
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: status as SupportTicketStatus } })
  }
}
