import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { sign, verify } from 'jsonwebtoken'
import * as argon2 from 'argon2'
import { prisma } from '@casino/database'
@Injectable()
export class AdminAuthService {
  constructor(private config: ConfigService) {}
  async validate(email: string, password: string) {
    const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() }})
    if (!admin || !admin.isActive) return null
    const ok = await argon2.verify(admin.passwordHash, password)
    if (!ok) return null
    return admin
  }
  sign(admin: { id: string; role: string }) {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET')!
    return sign({ sub: admin.id, role: admin.role, aud: 'admin' }, secret, { expiresIn: '8h', issuer: 'casino-platform' })
  }
  verify(token: string) { return verify(token, this.config.get<string>('JWT_ACCESS_SECRET')!) as any }
}
