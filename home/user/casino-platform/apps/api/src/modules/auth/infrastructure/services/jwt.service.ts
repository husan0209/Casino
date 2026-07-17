import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { sign, verify, JwtPayload } from 'jsonwebtoken'
import { randomBytes, createHash } from 'crypto'

export interface AccessTokenPayload extends JwtPayload {
  sub: string
  role: string
  session_id: string
}

@Injectable()
export class JwtTokenService {
  constructor(private config: ConfigService) {}

  signAccess(userId: string, role: string, sessionId: string): string {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET')!
    const expiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m'
    return sign(
      { sub: userId, role, session_id: sessionId },
      secret,
      { expiresIn, issuer: this.config.get('JWT_ISSUER') || 'casino-platform', audience: 'user' }
    )
  }

  verifyAccess(token: string): AccessTokenPayload {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET')!
    return verify(token, secret) as AccessTokenPayload
  }

  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(64).toString('hex')
    const hash = createHash('sha256').update(token).digest('hex')
    return { token, hash }
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
