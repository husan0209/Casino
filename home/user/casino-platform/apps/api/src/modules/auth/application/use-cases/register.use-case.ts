import { Inject, Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import { IEmailVerificationRepository, EMAIL_VERIFICATION_REPOSITORY } from '../../domain/repositories/verification-token.repository'
import { UserEntity } from '../../domain/entities/user.entity'
import { PasswordHasher } from '../../infrastructure/services/password-hasher.service'
import { EmailQueueService } from '../../infrastructure/services/email-queue.service'
import { EmailAlreadyExistsError, WeakPasswordError, ReferralCodeNotFoundError } from '../../domain/errors'

function genReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

@Injectable()
export class RegisterUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(EMAIL_VERIFICATION_REPOSITORY) private emailVerifications: IEmailVerificationRepository,
    private hasher: PasswordHasher,
    private emailQueue: EmailQueueService,
  ) {}

  async execute(input: { email: string; password: string; referralCode?: string }) {
    const email = input.email.toLowerCase().trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WeakPasswordError()
    if (input.password.length < 8) throw new WeakPasswordError()
    if (await this.users.existsByEmail(email)) throw new EmailAlreadyExistsError(email)

    let referredBy: string | null = null
    if (input.referralCode) {
      const referrer = await this.users.findByReferralCode(input.referralCode.toUpperCase())
      if (!referrer) throw new ReferralCodeNotFoundError(input.referralCode)
      referredBy = referrer.id
    }

    const passwordHash = await this.hasher.hash(input.password)
    let referralCode: string
    do { referralCode = genReferralCode() } while (await this.users.findByReferralCode(referralCode))

    const user = UserEntity.create({
      email,
      username: null,
      passwordHash,
      referralCode,
      referredBy,
    })

    const saved = await this.users.save(user)

    const token = randomBytes(64).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000)
    await this.emailVerifications.create(saved.id, token, expiresAt)

    await this.emailQueue.sendVerificationEmail(email, token)

    return { message: 'Confirm your email', verificationSent: true }
  }
}
