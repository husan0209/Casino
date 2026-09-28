import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

import { type IPasswordHasher } from '../../domain/auth.ports'

@Injectable()
export class PasswordHasher implements IPasswordHasher {
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
