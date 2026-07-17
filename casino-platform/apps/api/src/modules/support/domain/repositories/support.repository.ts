export type TicketStatus = 'open'|'in_progress'|'waiting_user'|'closed'
export type TicketCategory = 'payments'|'games'|'technical'|'account'|'other'
export type TicketPriority = 'low'|'normal'|'high'|'urgent'
export interface ISupportRepository {
  countOpenByUser(userId: string): Promise<number>
  createTicket(userId: string, subject: string, category: TicketCategory, message: string): Promise<{ id: string }>
  listUserTickets(userId: string, status?: TicketStatus, page?: number, perPage?: number): Promise<{ items: any[]; total: number }>
  getTicketForUser(ticketId: string, userId: string): Promise<any | null>
  addMessage(ticketId: string, senderType: 'user'|'admin', senderId: string, message: string, isInternal?: boolean, attachments?: any[]): Promise<any>
  listMessages(ticketId: string, includeInternal: boolean): Promise<any[]>
  closeTicket(ticketId: string, closedBy: 'user'|'admin'): Promise<void>
  // admin
  listAdmin(filters: { status?: TicketStatus; priority?: TicketPriority; category?: TicketCategory; assignedTo?: string; userId?: string; search?: string; page?: number; perPage?: number }): Promise<{ items: any[]; total: number }>
  getAdmin(ticketId: string): Promise<any | null>
  assign(ticketId: string, adminId: string | null): Promise<void>
  setPriority(ticketId: string, priority: TicketPriority): Promise<void>
  setStatus(ticketId: string, status: TicketStatus): Promise<void>
}
export const SUPPORT_REPOSITORY = Symbol('SUPPORT_REPOSITORY')
