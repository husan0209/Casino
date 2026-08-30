import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

@Injectable()
export class PasswordHasher {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    })
  }
  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain)
  }
}
