export interface KycSubmitInput {
  userId: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  country: string
  documentType: 'passport' | 'id_card' | 'drivers_license'
  documentNumber: string
  documentExpiry?: Date | null
}
/** Полная строка KYC-профиля (Prisma KycProfile + documents). */
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
export interface IKycRepository {
  getByUserId(userId: string): Promise<KycProfileRow | null>
  getById(id: string): Promise<KycProfileRow | null>
  submit(input: KycSubmitInput): Promise<KycProfileRow>
  addDocument(
    kycProfileId: string,
    doc: {
      documentType: string
      fileUrl: string
      fileName?: string
      fileSize?: number
      mimeType?: string
    },
  ): Promise<void>
  getStatus(
    userId: string,
  ): Promise<{
    status: string
    submittedAt: Date | null
    rejectionReason: string | null
    documents: string[]
  } | null>
  listAdmin(
    status?: string,
    page?: number,
    perPage?: number,
  ): Promise<{ items: KycProfileRow[]; total: number }>
  setStatus(args: {
    id: string
    status: 'approved' | 'rejected' | 'requires_resubmission'
    reason?: string
    reviewedBy?: string
  }): Promise<void>
  getTotalDepositedRub(userId: string): Promise<string>
}
export const KYC_REPOSITORY = Symbol('KYC_REPOSITORY')
