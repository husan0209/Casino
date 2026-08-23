export interface VerificationTokenView {
  id: string
  userId: string
  token: string
  expiresAt: Date
  usedAt: Date | null
}

export interface IEmailVerificationRepository {
  create(userId: string, token: string, expiresAt: Date): Promise<VerificationTokenView>
  findByToken(token: string): Promise<VerificationTokenView | null>
  markUsed(id: string): Promise<void>
}

export interface IPasswordResetRepository {
  create(userId: string, token: string, expiresAt: Date): Promise<VerificationTokenView>
  findByToken(token: string): Promise<VerificationTokenView | null>
  markUsed(id: string): Promise<void>
}

export const EMAIL_VERIFICATION_REPOSITORY = Symbol('EMAIL_VERIFICATION_REPOSITORY')
export const PASSWORD_RESET_REPOSITORY = Symbol('PASSWORD_RESET_REPOSITORY')
