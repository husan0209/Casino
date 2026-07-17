import { Injectable } from '@nestjs/common'
@Injectable()
export class GoogleOAuthUseCase {
  async execute(_code: string) {
    // TODO: exchange code -> profile, find/create user, issue tokens
    throw new Error('Google OAuth not configured – add GOOGLE_CLIENT_ID/SECRET')
  }
}
