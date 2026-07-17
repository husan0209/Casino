import { Inject, Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import { IPasswordResetRepository, PASSWORD_RESET_REPOSITORY } from '../../domain/repositories/verification-token.repository'
import { EmailQueueService } from '../../infrastructure/services/email-queue.service'
@Injectable()
export class ForgotPasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(PASSWORD_RESET_REPOSITORY) private resets: IPasswordResetRepository,
    private email: EmailQueueService,
  ) {}
  async execute(emailInput: string) {
    const user = await this.users.findByEmail(emailInput.toLowerCase().trim())
    if (user) {
      const token = randomBytes(64).toString('hex')
      const expiresAt = new Date(Date.now() + 3600*1000)
      await this.resets.create(user.id, token, expiresAt)
      await this.email.sendPasswordReset(user.email!, token)
    }
    return { message: 'If email exists, you will receive a link' }
  }
}
