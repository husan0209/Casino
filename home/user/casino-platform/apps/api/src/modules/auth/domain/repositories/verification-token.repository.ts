export interface EmailVerificationRecord {
  id: string; userId: string; token: string; expiresAt: Date; usedAt: Date | null; createdAt: Date
}
export interface IEmailVerificationRepository {
  create(userId: string, token: string, expiresAt: Date): Promise<EmailVerificationRecord>
  findByToken(token: string): Promise<EmailVerificationRecord | null>
  markUsed(id: string): Promise<void>
}
export const EMAIL_VERIFICATION_REPOSITORY = Symbol('EMAIL_VERIFICATION_REPOSITORY')

export interface PasswordResetRecord {
  id: string; userId: string; token: string; expiresAt: Date; usedAt: Date | null; createdAt: Date
}
export interface IPasswordResetRepository {
  create(userId: string, token: string, expiresAt: Date): Promise<PasswordResetRecord>
  findByToken(token: string): Promise<PasswordResetRecord | null>
  markUsed(id: string): Promise<void>
}
export const PASSWORD_RESET_REPOSITORY = Symbol('PASSWORD_RESET_REPOSITORY')
