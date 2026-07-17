import { AppError } from '@casino/shared-utils'
export class TicketNotFoundError extends AppError { readonly code='TICKET_NOT_FOUND'; readonly httpStatus=404; constructor(){ super('Тикет не найден') } }
export class TicketClosedError extends AppError { readonly code='TICKET_CLOSED'; readonly httpStatus=409; constructor(){ super('Тикет закрыт') } }
export class TooManyOpenTicketsError extends AppError { readonly code='TOO_MANY_OPEN_TICKETS'; readonly httpStatus=422; constructor(){ super('Максимум 5 открытых тикетов') } }
export class ForbiddenTicketError extends AppError { readonly code='FORBIDDEN'; readonly httpStatus=403; constructor(){ super('Нет доступа к тикету') } }
