/** Полная строка KYC-профиля (Prisma KycProfile + documents) — read-модель.
 *  В4: row-типы ответов API живут в shared-types, а не в домене модуля. */
export interface KycProfileRow {
  id: string
  userId: string
  status: string
  firstName: string | null
  lastName: string | null
  dateOfBirth: Date | null
  country: string | null
  documentType: string | null
  documentNumber: string | null
  rejectionReason: string | null
  submittedAt: Date | null
  approvedAt: Date | null
  rejectedAt: Date | null
}
