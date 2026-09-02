export type TicketStatus = 'open' | 'in_progress' | 'waiting_user' | 'closed'
export type TicketCategory = 'payments' | 'games' | 'technical' | 'account' | 'other'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
/** Форма тикета, возвращаемая репозиторием (Prisma SupportTicket + включённые поля). */
export interface TicketRow {
  id: string
  userId: string
  subject: string
  category: TicketCategory
  status: TicketStatus
  priority: TicketPriority
  assignedTo: string | null
  closedBy?: string | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
/** Строка списка тикетов (Prisma select — без user-полей) + счётчик сообщений. */
export interface TicketListItem {
  id: string
  subject: string
  category: TicketCategory
  status: TicketStatus
  priority: TicketPriority
  createdAt: Date
  updatedAt: Date
  _count: { messages: number }
}
/** Строка сообщения тикета (Prisma SupportMessage). */
export interface MessageRow {
  id: string
  ticketId: string
  senderType: 'user' | 'admin' | 'system' | (string & {})
  senderId: string | null
  message: string
  isInternal: boolean
  attachments: PrismaJson
  createdAt: Date
}
/** Prisma JsonValue-совместимый тип для JSON-полей. */
export type PrismaJson = string | number | boolean | null | PrismaJson[] | { [key: string]: PrismaJson }
/** Вложение к сообщению тикета (ссылка на сохранённый файл). */
export interface TicketAttachment {
  url: string
  name?: string
  mime?: string
}
/** Фильтры admin-списка тикетов (ISupportRepository.listAdmin). */
export interface TicketListItemFilters {
  status?: TicketStatus | undefined
  priority?: TicketPriority | undefined
  category?: TicketCategory | undefined
  assignedTo?: string | undefined
  userId?: string | undefined
  search?: string | undefined
  page?: number
  perPage?: number
}
export interface ISupportRepository {
  countOpenByUser(userId: string): Promise<number>
  createTicket(args: {
    userId: string
    subject: string
    category: TicketCategory
    message: string
  }): Promise<{ id: string }>
  listUserTickets(args: {
    userId: string
    status?: TicketStatus
    page: number
    perPage: number
  }): Promise<{ items: TicketListItem[]; total: number }>
  getTicketForUser(ticketId: string, userId: string): Promise<TicketRow | null>
  addMessage(args: {
    ticketId: string
    senderType: 'user' | 'admin'
    senderId: string
    message: string
    isInternal?: boolean
    attachments?: TicketAttachment[]
  }): Promise<{ id: string }>
  listMessages(ticketId: string, includeInternal: boolean): Promise<MessageRow[]>
  closeTicket(ticketId: string, closedBy: 'user' | 'admin'): Promise<void>
  // admin
  listAdmin(filters: {
    status?: TicketStatus | undefined
    priority?: TicketPriority | undefined
    category?: TicketCategory | undefined
    assignedTo?: string | undefined
    userId?: string | undefined
    search?: string | undefined
    page?: number
    perPage?: number
  }): Promise<{ items: TicketListItem[]; total: number }>
  getAdmin(ticketId: string): Promise<TicketRow | null>
  assign(ticketId: string, adminId: string | null): Promise<void>
  setPriority(ticketId: string, priority: TicketPriority): Promise<void>
  setStatus(ticketId: string, status: TicketStatus): Promise<void>
}
export const SUPPORT_REPOSITORY = Symbol('SUPPORT_REPOSITORY')
