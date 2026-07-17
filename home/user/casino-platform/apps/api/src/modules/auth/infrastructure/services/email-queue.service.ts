import { Injectable, Logger } from '@nestjs/common'
// Stub for MVP – logs instead of BullMQ
@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name)
  async sendVerificationEmail(email: string, token: string) {
    this.logger.log(`[EMAIL STUB] verification to ${email} token=${token}`)
  }
  async sendPasswordReset(email: string, token: string) {
    this.logger.log(`[EMAIL STUB] reset to ${email} token=${token}`)
  }
}
