import { createHmac, timingSafeEqual } from 'crypto'

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as argon2 from 'argon2'

import { prisma } from '@casino/database'

const b64url = (buf: Buffer) => buf.toString('base64url')

/** HS256 JWT на node:crypto — jsonwebtoken недоступен как зависимость (см. IMPLEMENTATION_GAPS GAP-01). */
function hs256(secret: string, header: object, payload: object): string {
  const h = b64url(Buffer.from(JSON.stringify(header)))
  const p = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${sig}`
}

function hs256Verify(secret: string, token: string): Record<string, unknown> {
  const [h, p, sig] = token.split('.') as [string, string, string]
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest()
  const given = Buffer.from(sig!, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error('BAD_SIGNATURE')
  }
  return JSON.parse(Buffer.from(p!, 'base64url').toString())
}

@Injectable()
export class AdminAuthService {
  constructor(private config: ConfigService) {}
  async validate(email: string, password: string) {
    const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } })
    if (!admin || !admin.isActive) {
      return null
    }
    const ok = await argon2.verify(admin.passwordHash, password)
    if (!ok) {
      return null
    }
    return admin
  }
  sign(admin: { id: string; role: string }): string {
    const now = Math.floor(Date.now() / 1000)
    const token = hs256(
      this.config.get<string>('JWT_ACCESS_SECRET')!,
      { alg: 'HS256', typ: 'JWT' },
      {
        sub: admin.id,
        role: admin.role,
        aud: 'admin',
        iss: 'casino-platform',
        iat: now,
        exp: now + 8 * 3600,
      },
    )
    return token
  }
  verify(token: string): Record<string, unknown> {
    const payload = hs256Verify(this.config.get<string>('JWT_ACCESS_SECRET')!, token)
    const exp = typeof payload['exp'] === 'number' ? payload['exp'] : 0
    if (exp * 1000 < Date.now()) {
      throw new Error('TOKEN_EXPIRED')
    }
    return payload
  }
}
