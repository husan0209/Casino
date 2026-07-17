export interface KycSubmitInput {
  userId: string; firstName: string; lastName: string; dateOfBirth: Date; country: string;
  documentType: 'passport'|'id_card'|'drivers_license'; documentNumber: string; documentExpiry?: Date | null
}
export interface IKycRepository {
  getByUserId(userId: string): Promise<any | null>
  submit(input: KycSubmitInput): Promise<any>
  addDocument(kycProfileId: string, doc: { documentType: string; fileUrl: string; fileName?: string; fileSize?: number; mimeType?: string }): Promise<any>
  getStatus(userId: string): Promise<{status:string; submittedAt: Date | null; rejectionReason: string | null; documents: string[] } | null>
  listAdmin(status?: string, page?: number, perPage?: number): Promise<{items:any[]; total:number}>
  setStatus(id: string, status: 'approved'|'rejected'|'requires_resubmission', reason?: string, reviewedBy?: string): Promise<void>
  getTotalDepositedRub(userId: string): Promise<string>
}
export const KYC_REPOSITORY = Symbol('KYC_REPOSITORY')
