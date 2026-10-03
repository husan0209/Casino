/**
 * ТЗ ч.5.1 §5.7: статус верификации — спокойная русская строка, сырой enum
 * (not_started/pending/…) в витрине не светим. Общий для профиля и страницы KYC.
 */
const KYC_LABEL: Record<string, string> = {
  not_started: 'не начата',
  pending: 'на проверке',
  approved: 'пройдена',
  rejected: 'отклонена',
  requires_resubmission: 'нужны новые документы',
}

export function kycStatusLabel(status: string | null | undefined): string {
  return KYC_LABEL[status ?? ''] ?? 'не начата'
}
