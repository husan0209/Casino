import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 })
  }
  async verify(hash: string, password: string): Promise<boolean> {
    try { return await argon2.verify(hash, password) } catch { return false }
  }
}
