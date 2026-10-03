/**
 * Read-модели поддержки (Prisma SupportTicket / SupportMessage) — формы ответов
 * API тикетов.
 *
 * В4: row-типы ответов API живут в shared-types, а не в домене модуля. Статусы
 * и категории остаются строковыми юнионами (не enum): их значения — часть
 * HTTP-контракта, а домен над ними не имеет поведения.
 */

export type TicketStatus = 'open' | 'in_progress' | 'waiting_user' | 'closed'
export type TicketCategory = 'payments' | 'games' | 'technical' | 'account' | 'other'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

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
  senderType: string
  senderId: string | null
  message: string
  isInternal: boolean
  attachments: unknown // Prisma Prisma.JsonValue
  createdAt: Date
}
