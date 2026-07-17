import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
import { IAuthProviderRepository } from '../../domain/repositories/auth-provider.repository'

@Injectable()
export class PrismaAuthProviderRepository implements IAuthProviderRepository {
  async findByProvider(provider: 'google' | 'telegram', providerUserId: string) {
    return prisma.authProvider.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } }
    }) as any
  }
  async create(data: any) {
    return prisma.authProvider.create({ data }) as any
  }
}
