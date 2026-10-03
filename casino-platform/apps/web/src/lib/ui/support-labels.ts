/**
 * ТЗ ч.5.1 §5: сырые enum'ы Prisma (open / in_progress / payments / admin) в
 * витрине не светим. Общий источник подписей для списка тикетов и карточки.
 */
const CATEGORY_LABEL: Record<string, string> = {
  payments: 'Платежи',
  games: 'Игры',
  technical: 'Техника',
  account: 'Аккаунт',
  other: 'Другое',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'открыт',
  in_progress: 'в работе',
  waiting_user: 'нужен ваш ответ',
  closed: 'закрыт',
}

const STATUS_CLASS: Record<string, string> = {
  open: 'border-[#FFB300]/40 text-[#FFB300]',
  in_progress: 'border-brand/40 text-brand-light',
  waiting_user: 'border-[#FFB300]/40 text-[#FFB300]',
  closed: 'text-muted',
}

const SENDER_LABEL: Record<string, string> = {
  user: 'Вы',
  admin: 'Поддержка',
}

export function ticketCategoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category
}

export function ticketStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

export function ticketStatusClass(status: string): string {
  return STATUS_CLASS[status] ?? 'text-muted'
}

export function senderLabel(senderType: string): string {
  return SENDER_LABEL[senderType] ?? senderType
}
