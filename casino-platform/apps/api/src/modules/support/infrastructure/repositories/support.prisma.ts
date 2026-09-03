import { Injectable } from '@nestjs/common'

import { prisma, type Prisma, type SupportSenderType, type SupportTicketCategory, type SupportTicketPriority, type SupportTicketStatus } from '@casino/database'

import { type ISupportRepository, type MessageRow, type TicketAttachment, type TicketCategory, type TicketListItem, type TicketListItemFilters, type TicketPriority, type TicketRow, type TicketStatus } from '../../domain/repositories/support.repository'

/** Полная карточка тикета для админки (getAdmin): TicketRow + user + assignee + messages. */
export type AdminTicketFull = TicketRow & {
  user: { id: string; email: string | null }
  assignee: AdminUserRow | null
  messages: MessageRow[]
}

type AdminUserRow = {
  id: string
  email: string
  role: string
  firstName: string | null
  lastName: string | null
  isActive: boolean
  passwordHash: string
  createdAt: Date
  updatedAt: Date
}

@Injectable()
export class PrismaSupportRepository implements ISupportRepository {
  async countOpenByUser(userId: string): Promise<number> {
    return prisma.supportTicket.count({
      where: { userId, status: { in: ['open', 'in_progress', 'waiting_user'] } },
    })
  }
  async createTicket(args: {
    userId: string
    subject: string
    category: TicketCategory
    message: string
  }): Promise<{ id: string }> {
    const { userId, subject, category, message } = args
    const ticket = await prisma.$transaction(
      async (tx: Omit<Prisma.TransactionClient, '$transaction'>) => {
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
      },
    )
    return { id: ticket.id }
  }
  async listUserTickets(args: {
    userId: string
    status?: TicketStatus | undefined
    page: number
    perPage: number
  }): Promise<{ items: TicketListItem[]; total: number }> {
    const { userId, status, page, perPage } = args
    const where: Prisma.SupportTicketWhereInput = { userId }
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
  async getTicketForUser(ticketId: string, userId: string): Promise<TicketRow | null> {
    return prisma.supportTicket.findFirst({ where: { id: ticketId, userId } })
  }
  async addMessage(args: {
    ticketId: string
    senderType: 'user' | 'admin'
    senderId: string
    message: string
    isInternal?: boolean
    attachments?: TicketAttachment[]
  }): Promise<{ id: string; createdAt: Date; message: string; senderType: SupportSenderType; senderId: string; attachments: Prisma.JsonValue; isInternal: boolean; ticketId: string; }> {
    const { ticketId, senderType, senderId, message } = args
    const isInternal = args.isInternal ?? false
    const attachments = (args.attachments ?? []) as unknown as Prisma.InputJsonValue[]
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
  async listMessages(ticketId: string, includeInternal: boolean): Promise<MessageRow[]> {
    return prisma.supportMessage.findMany({
      where: { ticketId, ...(includeInternal ? {} : { isInternal: false }) },
      orderBy: { createdAt: 'asc' },
    })
  }
  async closeTicket(ticketId: string, closedBy: 'user' | 'admin'): Promise<void> {
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: 'closed', closedAt: new Date(), closedBy },
    })
  }
  async listAdmin(f: TicketListItemFilters): Promise<{ items: TicketListItem[]; total: number }> {
    const page = f.page || 1,
      perPage = Math.min(f.perPage || 20, 100)
    const where: Prisma.SupportTicketWhereInput = {}
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
  async getAdmin(ticketId: string): Promise<AdminTicketFull | null> {
    // Prisma-enum (SupportTicketCategory/Priority) -> доменные string-union:
    // один каст на границе репозитория (значения совпадают со схемой)
    return (await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        assignee: true,
      },
    })) as AdminTicketFull | null
  }
  async assign(ticketId: string, adminId: string | null): Promise<void> {
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { assignedTo: adminId } })
  }
  async setPriority(ticketId: string, priority: TicketPriority): Promise<void> {
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { priority: priority as SupportTicketPriority },
    })
  }
  async setStatus(ticketId: string, status: TicketStatus): Promise<void> {
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: status as SupportTicketStatus } })
  }
}
