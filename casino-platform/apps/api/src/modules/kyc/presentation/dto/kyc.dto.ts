import { z } from 'zod'

// GAP-21: POST /kyc/submit — анкетные данные (строгий KYC, поля обязательны).
export const SubmitKycSchema = z.object({
  first_name: z.string().min(1).max(64),
  last_name: z.string().min(1).max(64),
  date_of_birth: z.string().min(1).max(32),
  country: z.string().min(2).max(64),
  document_type: z.string().min(1).max(32),
  document_number: z.string().min(1).max(64),
  document_expiry: z.string().min(1).max(32).optional(),
})

// POST /kyc/documents (multipart) — текстовое поле рядом с файлом.
export const KycDocumentTypeSchema = z.object({
  document_type: z.string().min(1).max(32),
})

// POST /kyc-admin/:id/reject и /request-resubmission — причина решения.
export const KycDecisionReasonSchema = z.object({
  reason: z.string().min(1).max(500),
})

export type SubmitKycDto = z.infer<typeof SubmitKycSchema>
export type KycDocumentTypeDto = z.infer<typeof KycDocumentTypeSchema>
export type KycDecisionReasonDto = z.infer<typeof KycDecisionReasonSchema>
