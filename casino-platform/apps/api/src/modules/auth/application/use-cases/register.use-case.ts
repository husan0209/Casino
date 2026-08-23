import { Inject, Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import { IEmailVerificationRepository, EMAIL_VERIFICATION_REPOSITORY } from '../../domain/repositories/verification-token.repository'
import { PasswordHasher } from '../../infrastructure/services/password-hasher.service'
import { EmailQueueService } from '../../infrastructure/services/email-queue.service'
import { EmailAlreadyExistsError, WeakPasswordError } from '../../domain/errors'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // без 0/O/1/I — меньше ошибок при вводе
const CODE_LENGTH = 8

@Injectable()
export class RegisterUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(EMAIL_VERIFICATION_REPOSITORY) private verif: IEmailVerificationRepository,
    private hasher: PasswordHasher,
    private email: EmailQueueService,
  ) {}

  private async generateReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = randomBytes(CODE_LENGTH)
      let code = ''
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
      if (!(await this.users.referralCodeExists(code))) return code
    }
    throw new Error('REFERRAL_CODE_GENERATION_FAILED')
  }

  async execute(input: { email: string; password: string; referralCode?: string }) {
    if (input.password.length < 8) throw new WeakPasswordError()
    const emailNormalized = input.email.toLowerCase().trim()

    const existing = await this.users.findByEmail(emailNormalized)
    if (existing) throw new EmailAlreadyExistsError()

    // UC-REF-02: если код не найден — игнорируем, регистрацию не блокируем
    let referredBy: string | null = null
    if (input.referralCode) {
      const referrer = await this.users.findByReferralCode(input.referralCode.toUpperCase().trim())
      if (referrer) referredBy = referrer.id
    }

    const passwordHash = await this.hasher.hash(input.password)
    const referralCode = await this.generateReferralCode()
    const user = await this.users.create({ email: emailNormalized, passwordHash, referralCode, referredBy })

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000)
    await this.verif.create(user.id, token, expiresAt)
    await this.email.sendVerificationEmail(emailNormalized, token)

    return { userId: user.id, referralCode, message: 'Регистрация успешна. Подтвердите email по ссылке из письма.' }
  }
}
