/**
 * DTO поддержки (контракт /support/*).
 */

/** Тикет в списке (GET /support/tickets data[] — Prisma as-is, camelCase). */
export interface SupportTicketDto {
  id: string
  subject: string
  category: string
  status: string
  priority: string
  createdAt: string
  updatedAt: string
  _count?: { messages: number }
}

/** Сообщение тикета (Prisma SupportMessage, camelCase). */
export interface SupportMessageDto {
  id: string
  ticketId: string
  senderType: string
  senderId: string | null
  message: string
  isInternal: boolean
  createdAt: string
}

/** Ответ GET /support/tickets/:id ({...ticket, messages}). */
export interface SupportTicketFullDto extends SupportTicketDto {
  userId: string
  messages: SupportMessageDto[]
}

/** Ответ GET /support/tickets. */
export interface SupportTicketsListDto {
  data: SupportTicketDto[]
  meta: { total: number }
}
