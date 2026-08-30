import { z } from 'zod'

// GAP-21: тикеты поддержки. category — свободная строка (справочник в UI),
// priority — закрытый enum из domain (TicketPriority).
export const CreateTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  category: z.string().min(1).max(64),
  message: z.string().min(1).max(5000),
})

export const AddTicketMessageSchema = z.object({
  message: z.string().min(1).max(5000),
})

export const AddAdminMessageSchema = z.object({
  message: z.string().min(1).max(5000),
  is_internal: z.boolean().optional(),
})

export const AssignTicketSchema = z.object({
  admin_id: z.string().min(1).optional(),
})

export const SetPrioritySchema = z.object({
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
})

export type CreateTicketDto = z.infer<typeof CreateTicketSchema>
export type AddTicketMessageDto = z.infer<typeof AddTicketMessageSchema>
export type AddAdminMessageDto = z.infer<typeof AddAdminMessageSchema>
export type AssignTicketDto = z.infer<typeof AssignTicketSchema>
export type SetPriorityDto = z.infer<typeof SetPrioritySchema>
